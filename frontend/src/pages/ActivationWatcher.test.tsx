import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, NETWORK_ERROR, SERVER_UNAVAILABLE } from '../api/client';
import type { CompanyStatus, OnboardingStatus, Payment, PaymentCheckout, PaymentStatus } from '../api/types';
import { ActivationWatcher } from './ActivationWatcher';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const POLL = 2000;
const SLOW = 15_000;
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

const session = { token: 'tok', companyName: 'Acme' };

const status = (companyStatus: CompanyStatus): OnboardingStatus => ({
  company: { id: 'c1', name: 'Acme', status: companyStatus, activatedAt: null },
  nextStep: companyStatus === 'ACTIVE' ? 'DONE' : 'PAYMENT',
});
const payment = (paymentStatus: PaymentStatus): Payment => ({
  id: 'p1',
  status: paymentStatus,
  amount: { amountMinor: 4900, currency: 'USD' },
  failureCode: null,
  providerRef: 'pi_1',
  createdAt: '2026-11-09T12:00:00Z',
});

function setup() {
  vi.spyOn(api, 'getPayment').mockResolvedValue(payment('PROCESSING'));
  const callbacks = { onActive: vi.fn(), onPaymentProblem: vi.fn(), onSessionExpired: vi.fn() };
  render(<ActivationWatcher session={session} paymentId="p1" {...callbacks} />);
  return callbacks;
}

describe('ActivationWatcher', () => {
  it('keeps asking until the company is ACTIVE, then reports it', async () => {
    const poll = vi
      .spyOn(api, 'onboardingStatus')
      .mockResolvedValueOnce(status('PENDING_PAYMENT'))
      .mockResolvedValueOnce(status('PENDING_PAYMENT'))
      .mockResolvedValue(status('ACTIVE'));
    const { onActive } = setup();

    await advance(0);
    await advance(POLL);
    expect(onActive).not.toHaveBeenCalled();
    await advance(POLL);

    expect(onActive).toHaveBeenCalledTimes(1);
    expect(poll).toHaveBeenCalledTimes(3);
    expect(poll).toHaveBeenCalledWith('tok');
  });

  it('stops polling once active', async () => {
    const poll = vi.spyOn(api, 'onboardingStatus').mockResolvedValue(status('ACTIVE'));
    const { onActive } = setup();
    await advance(0);
    expect(onActive).toHaveBeenCalled();

    await advance(10 * POLL);

    expect(poll).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the browser is offline', new ApiError(0, NETWORK_ERROR, 'Cannot reach the server.')],
    ['the API is down behind the web server (504)', new ApiError(504, SERVER_UNAVAILABLE, 'The service is temporarily unavailable.')],
  ])('when %s: says the service cannot be reached, that the payment is safe, keeps trying, and recovers by itself', async (_label, failure) => {
    vi.spyOn(api, 'onboardingStatus')
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(status('PENDING_PAYMENT'))
      .mockResolvedValue(status('ACTIVE'));
    const { onActive } = setup();

    await advance(0);
    expect(screen.getByRole('alert')).toHaveTextContent("We can't reach the service right now. Your payment is safe");
    await advance(POLL);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await advance(POLL);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onActive).not.toHaveBeenCalled();

    await advance(POLL);
    expect(onActive).toHaveBeenCalledTimes(1);
  });

  it('does not claim the service is unreachable for an ordinary server error', async () => {
    vi.spyOn(api, 'onboardingStatus')
      .mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred'))
      .mockResolvedValue(status('ACTIVE'));
    const { onActive } = setup();

    await advance(0);
    expect(screen.queryByText(/can't reach the service/)).not.toBeInTheDocument();

    await advance(POLL);
    expect(onActive).toHaveBeenCalled();
  });

  it('only says it is taking longer than usual after a while', async () => {
    vi.spyOn(api, 'onboardingStatus').mockResolvedValue(status('PENDING_PAYMENT'));
    setup();

    await advance(SLOW - POLL);
    expect(screen.queryByText(/taking longer than usual/)).not.toBeInTheDocument();

    await advance(2 * POLL);
    expect(screen.getByText(/taking longer than usual/)).toBeInTheDocument();
  });

  describe('when it is taking longer than usual', () => {
    async function pressCheckAgain(answer: PaymentCheckout | Error) {
      vi.spyOn(api, 'onboardingStatus').mockResolvedValue(status('PENDING_PAYMENT'));
      const resume = vi.spyOn(api, 'startPayment').mockImplementation(() => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)));
      const callbacks = setup();
      await advance(SLOW + POLL);
      fireEvent.click(screen.getByRole('button', { name: 'Check again now' }));
      await advance(0);
      return { ...callbacks, resume };
    }

    it('"Check again" resumes the payment, which makes the backend ask the provider', async () => {
      const { resume, onPaymentProblem } = await pressCheckAgain({ payment: payment('SUCCEEDED'), clientSecret: null });

      expect(resume).toHaveBeenCalledWith('tok');
      expect(onPaymentProblem).not.toHaveBeenCalled();
    });

    it('"Check again" sends the customer back to pay if the provider says the payment is not going through', async () => {
      const { onPaymentProblem } = await pressCheckAgain({ payment: payment('CREATED'), clientSecret: 'secret' });

      expect(onPaymentProblem).toHaveBeenCalledTimes(1);
    });

    it('"Check again" is not an error if the company was activated in the meantime (the next poll shows it)', async () => {
      const { onPaymentProblem, onSessionExpired } = await pressCheckAgain(new ApiError(409, 'COMPANY_ALREADY_ACTIVE', 'This account is already active'));

      expect(screen.getByRole('button', { name: 'Check again now' })).toBeEnabled();
      expect(screen.queryByText(/already active/)).not.toBeInTheDocument();
      expect(onPaymentProblem).not.toHaveBeenCalled();
      expect(onSessionExpired).not.toHaveBeenCalled();
    });

    it('"Check again" with an expired token ends the session', async () => {
      const { onSessionExpired } = await pressCheckAgain(new ApiError(401, 'UNAUTHORIZED', 'Unauthorized'));

      expect(onSessionExpired).toHaveBeenCalledTimes(1);
    });

    it('"Check again" shows what went wrong, and can be tried again', async () => {
      await pressCheckAgain(new TypeError('boom'));

      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
      expect(screen.getByRole('button', { name: 'Check again now' })).toBeEnabled();
    });
  });

  it('notices a payment that fails AFTER it was submitted (e.g. the bank declines later)', async () => {
    vi.spyOn(api, 'onboardingStatus').mockResolvedValue(status('PENDING_PAYMENT'));
    const { onPaymentProblem, onActive } = setup();
    const getPayment = vi.spyOn(api, 'getPayment').mockResolvedValueOnce(payment('PROCESSING')).mockResolvedValue(payment('FAILED'));

    await advance(0);
    expect(onPaymentProblem).not.toHaveBeenCalled();
    await advance(POLL);

    expect(onPaymentProblem).toHaveBeenCalledTimes(1);
    expect(getPayment).toHaveBeenCalledWith('tok', 'p1');
    expect(onActive).not.toHaveBeenCalled();
  });

  it('ends the session when the token is no longer accepted', async () => {
    vi.spyOn(api, 'onboardingStatus').mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Unauthorized'));
    const { onSessionExpired } = setup();

    await advance(0);

    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    await advance(5 * POLL);
    expect(api.onboardingStatus).toHaveBeenCalledTimes(1);
  });
});
