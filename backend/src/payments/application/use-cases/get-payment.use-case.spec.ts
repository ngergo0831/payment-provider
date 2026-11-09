import { PaymentNotFoundException } from '../../../common/errors/payment-exceptions';
import { InMemoryPaymentRepository } from '../../../testing/in-memory-payments';
import { Money } from '../../domain/money';
import { Payment } from '../../domain/payment';
import { GetPaymentUseCase } from './get-payment.use-case';

async function setup() {
  const payments = new InMemoryPaymentRepository();
  const payment = Payment.start({ companyId: 'alice', provider: 'mock', amount: Money.of(4900, 'USD') });
  await payments.insert(payment);
  return { payment, useCase: new GetPaymentUseCase(payments) };
}

describe('GetPaymentUseCase', () => {
  it("returns the company's own payment", async () => {
    const { payment, useCase } = await setup();
    expect((await useCase.execute(payment.id, 'alice')).id).toBe(payment.id);
  });

  it("says 'not found' for another company's payment: its existence is not revealed", async () => {
    const { payment, useCase } = await setup();
    await expect(useCase.execute(payment.id, 'mallory')).rejects.toBeInstanceOf(PaymentNotFoundException);
  });

  it('says not found for an unknown id', async () => {
    const { useCase } = await setup();
    await expect(useCase.execute('00000000-0000-4000-8000-000000000000', 'alice')).rejects.toBeInstanceOf(PaymentNotFoundException);
  });
});
