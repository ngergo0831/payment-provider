import { InMemoryPaymentRepository } from '../../testing/in-memory-payments';
import { Money } from '../domain/money';
import { Payment } from '../domain/payment';
import { PaymentStatus } from '../domain/payment-status';
import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { PaymentNotFoundException } from '../../common/errors/exceptions';
import { PaymentRecordConflictException } from './payment-record-conflict.exception';
import { PaymentSynchronizer } from './payment-synchronizer';
import { ProviderPayment } from './ports/payment-provider';
import { PaymentConcurrentModificationError } from './ports/repositories';

const remote = (overrides: Partial<ProviderPayment> = {}): ProviderPayment => ({
  providerRef: 'pi_1',
  status: PaymentStatus.CREATED,
  amount: Money.of(4900, 'USD'),
  clientSecret: 'secret',
  failureCode: null,
  ...overrides,
});

async function setup() {
  const repo = new InMemoryPaymentRepository();
  const payment = Payment.start({ companyId: 'c1', provider: 'mock', amount: Money.of(4900, 'USD') });
  await repo.insert(payment);
  return { repo, payment, synchronizer: new PaymentSynchronizer(repo) };
}

describe('PaymentSynchronizer', () => {
  it('links the provider reference, applies the provider status and records when it synchronised', async () => {
    const { synchronizer, payment } = await setup();

    const saved = await synchronizer.apply(payment.id, remote({ status: PaymentStatus.SUCCEEDED }));

    expect(saved).toMatchObject({ providerRef: 'pi_1', status: PaymentStatus.SUCCEEDED, version: 1 });
    expect(saved.lastSyncedAt).toBeInstanceOf(Date);
  });

  it('is idempotent: applying the same provider snapshot twice leaves the same state', async () => {
    const { synchronizer, payment } = await setup();
    const snapshot = remote({ status: PaymentStatus.FAILED, failureCode: 'card_declined' });

    await synchronizer.apply(payment.id, snapshot);
    const second = await synchronizer.apply(payment.id, snapshot);

    expect(second).toMatchObject({ status: PaymentStatus.FAILED, failureCode: 'card_declined' });
  });

  it('ignores stale news instead of regressing the payment (a success is not undone by a late failure)', async () => {
    const { synchronizer, payment } = await setup();
    await synchronizer.apply(payment.id, remote({ status: PaymentStatus.SUCCEEDED }));

    const saved = await synchronizer.apply(payment.id, remote({ status: PaymentStatus.FAILED, failureCode: 'late' }));

    expect(saved.status).toBe(PaymentStatus.SUCCEEDED);
    expect(saved.failureCode).toBeNull();
  });

  describe('when another request saved first (optimistic lock lost)', () => {
    it('re-reads the newest version and applies again, so the caller still succeeds', async () => {
      const { synchronizer, payment, repo } = await setup();
      repo.conflictsToInject = 2;

      const saved = await synchronizer.apply(payment.id, remote({ status: PaymentStatus.PROCESSING }));

      expect(saved.status).toBe(PaymentStatus.PROCESSING);
      expect(repo.saveCalls).toBe(3);
    });

    it('does not write again when the winner already applied the SAME news: no retry storm', async () => {
      const { synchronizer, payment, repo } = await setup();
      const news = remote({ status: PaymentStatus.SUCCEEDED });

      const results = await Promise.all(Array.from({ length: 5 }, () => synchronizer.apply(payment.id, news)));

      expect(results.every((saved) => saved.status === PaymentStatus.SUCCEEDED)).toBe(true);
      expect(repo.saveCalls).toBeLessThanOrEqual(5);
      expect((await repo.findById(payment.id))?.version).toBe(1);
    });

    it('gives up after 3 attempts with the conflict error, rather than looping forever', async () => {
      const { synchronizer, payment, repo } = await setup();
      repo.conflictsToInject = 10;

      await expect(synchronizer.apply(payment.id, remote())).rejects.toBeInstanceOf(PaymentConcurrentModificationError);
      expect(repo.saveCalls).toBe(3);
    });
  });

  describe('the "payment succeeded" outbox message', () => {
    it('is queued exactly when the payment becomes SUCCEEDED, naming the payment and its company', async () => {
      const { synchronizer, payment, repo } = await setup();

      await synchronizer.apply(payment.id, remote({ status: PaymentStatus.SUCCEEDED }));

      expect(repo.outbox).toEqual([
        { id: expect.any(String), type: 'payment.succeeded', payload: { paymentId: payment.id, companyId: 'c1' } },
      ]);
    });

    it.each([PaymentStatus.CREATED, PaymentStatus.REQUIRES_ACTION, PaymentStatus.PROCESSING, PaymentStatus.FAILED, PaymentStatus.CANCELED])(
      'is NOT queued for %s',
      async (status) => {
        const { synchronizer, payment, repo } = await setup();
        await synchronizer.apply(payment.id, remote({ status, failureCode: status === PaymentStatus.FAILED ? 'x' : null }));
        expect(repo.outbox).toEqual([]);
      },
    );

    it('is queued ONCE even if the success is reported again (a duplicate webhook, a reconciliation pass)', async () => {
      const { synchronizer, payment, repo } = await setup();
      const news = remote({ status: PaymentStatus.SUCCEEDED });

      await synchronizer.apply(payment.id, news);
      await synchronizer.apply(payment.id, news);
      await synchronizer.apply(payment.id, news);

      expect(repo.outbox).toHaveLength(1);
    });

    it('is queued ONCE when five requests report the success at the same moment', async () => {
      const { synchronizer, payment, repo } = await setup();
      const news = remote({ status: PaymentStatus.SUCCEEDED });

      await Promise.all(Array.from({ length: 5 }, () => synchronizer.apply(payment.id, news)));

      expect(repo.outbox).toHaveLength(1);
    });

    it('is NOT queued when the save lost the race (nothing was saved, so nothing is announced)', async () => {
      const { synchronizer, payment, repo } = await setup();
      repo.conflictsToInject = 10;

      await expect(synchronizer.apply(payment.id, remote({ status: PaymentStatus.SUCCEEDED }))).rejects.toThrow();

      expect(repo.outbox).toEqual([]);
    });

    it('is NOT queued for a late "succeeded" on a payment that was already canceled (the move is rejected)', async () => {
      const { synchronizer, payment, repo } = await setup();
      await synchronizer.apply(payment.id, remote({ status: PaymentStatus.CANCELED }));

      await synchronizer.apply(payment.id, remote({ status: PaymentStatus.SUCCEEDED }));

      expect(repo.outbox).toEqual([]);
    });
  });

  describe('safety checks', () => {
    beforeEach(() => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    it('REFUSES to proceed when the provider reports a different amount than we asked for', async () => {
      const { synchronizer, payment, repo } = await setup();

      await expect(synchronizer.apply(payment.id, remote({ amount: Money.of(100, 'USD') }))).rejects.toBeInstanceOf(
        PaymentRecordConflictException,
      );
      expect((await repo.findById(payment.id))?.providerRef).toBeNull();
    });

    it('refuses a different currency even with the same number', async () => {
      const { synchronizer, payment } = await setup();
      await expect(synchronizer.apply(payment.id, remote({ amount: Money.of(4900, 'EUR') }))).rejects.toBeInstanceOf(
        PaymentRecordConflictException,
      );
    });

    it('refuses to link a payment to a second, different provider payment', async () => {
      const { synchronizer, payment } = await setup();
      await synchronizer.apply(payment.id, remote({ providerRef: 'pi_1' }));
      await expect(synchronizer.apply(payment.id, remote({ providerRef: 'pi_OTHER' }))).rejects.toMatchObject({
        reason: expect.stringMatching(/already linked to pi_1/),
      });
    });

    it('fails clearly when the payment no longer exists', async () => {
      const { synchronizer } = await setup();
      await expect(synchronizer.apply('00000000-0000-4000-8000-000000000000', remote())).rejects.toBeInstanceOf(PaymentNotFoundException);
    });
  });
});
