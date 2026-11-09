import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, NETWORK_ERROR, SERVER_UNAVAILABLE } from '../api/client';
import type { CompanyStatus, OnboardingStatus, Payment, PaymentStatus } from '../api/types';
import { ActivationWatcher } from './ActivationWatcher';

afterEach(() => vi.restoreAllMocks());

const session = { token: 'tok', companyName: 'Acme', email: 'jane@acme.example' };

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

function setup(props: { paymentId?: string; slowAfterMs?: number } = {}) {
  const callbacks = { onActive: vi.fn(), onPaymentProblem: vi.fn(), onSessionExpired: vi.fn() };
  render(<ActivationWatcher session={session} intervalMs={10} slowAfterMs={props.slowAfterMs ?? 60_000} {...props} {...callbacks} />);
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

    await waitFor(() => expect(onActive).toHaveBeenCalledTimes(1));
    expect(poll).toHaveBeenCalledTimes(3);
    expect(poll).toHaveBeenCalledWith('tok');
  });

  it('stops polling once active', async () => {
    const poll = vi.spyOn(api, 'onboardingStatus').mockResolvedValue(status('ACTIVE'));
    const { onActive } = setup();
    await waitFor(() => expect(onActive).toHaveBeenCalled());

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(poll).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the browser is offline', new ApiError(0, NETWORK_ERROR, 'Cannot reach the server.')],
    ['the API is down behind the web server (504)', new ApiError(504, SERVER_UNAVAILABLE, 'The service is temporarily unavailable.')],
  ])('when %s: says the service cannot be reached, that the payment is safe, keeps trying, and recovers by itself', async (_label, failure) => {
    vi.spyOn(api, 'onboardingStatus').mockRejectedValueOnce(failure).mockRejectedValueOnce(failure).mockResolvedValue(status('ACTIVE'));
    const { onActive } = setup();

    expect(await screen.findByRole('alert')).toHaveTextContent("We can't reach the service right now. Your payment is safe");
    await waitFor(() => expect(onActive).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not claim the service is unreachable for an ordinary server error', async () => {
    vi.spyOn(api, 'onboardingStatus')
      .mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred'))
      .mockResolvedValue(status('ACTIVE'));
    const { onActive } = setup();

    await waitFor(() => expect(onActive).toHaveBeenCalled());
    expect(screen.queryByText(/can't reach the service/)).not.toBeInTheDocument();
  });

  it('says it is taking longer than usual, and "Check again" resumes the payment to make the backend ask the provider', async () => {
    vi.spyOn(api, 'onboardingStatus').mockResolvedValue(status('PENDING_PAYMENT'));
    const resume = vi.spyOn(api, 'startPayment').mockResolvedValue({ payment: payment('SUCCEEDED'), clientSecret: null });
    const { onPaymentProblem } = setup({ slowAfterMs: 30 });

    expect(await screen.findByText(/taking longer than usual/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check again now' }));

    expect(resume).toHaveBeenCalledWith('tok');
    expect(onPaymentProblem).not.toHaveBeenCalled(); // the provider says it is paid: just keep waiting for activation
  });

  it('"Check again" sends the customer back to pay if the provider says the payment is not going through', async () => {
    vi.spyOn(api, 'onboardingStatus').mockResolvedValue(status('PENDING_PAYMENT'));
    vi.spyOn(api, 'startPayment').mockResolvedValue({ payment: payment('CREATED'), clientSecret: 'secret' });
    const { onPaymentProblem } = setup({ slowAfterMs: 30 });

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Check again now' }));

    await waitFor(() => expect(onPaymentProblem).toHaveBeenCalled());
  });

  it('"Check again" is not an error if the company was activated in the meantime (the next poll shows it)', async () => {
    vi.spyOn(api, 'onboardingStatus').mockResolvedValue(status('PENDING_PAYMENT'));
    vi.spyOn(api, 'startPayment').mockRejectedValue(new ApiError(409, 'COMPANY_ALREADY_ACTIVE', 'This account is already active'));
    const { onPaymentProblem, onSessionExpired } = setup({ slowAfterMs: 30 });

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Check again now' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Check again now' })).toBeEnabled());
    expect(screen.queryByText(/already active/)).not.toBeInTheDocument();
    expect(onPaymentProblem).not.toHaveBeenCalled();
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('"Check again" with an expired token ends the session', async () => {
    vi.spyOn(api, 'onboardingStatus').mockResolvedValue(status('PENDING_PAYMENT'));
    vi.spyOn(api, 'startPayment').mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Unauthorized'));
    const { onSessionExpired } = setup({ slowAfterMs: 30 });

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Check again now' }));

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalled());
  });

  it('notices a payment that fails AFTER it was submitted (e.g. the bank declines later)', async () => {
    vi.spyOn(api, 'onboardingStatus').mockResolvedValue(status('PENDING_PAYMENT'));
    const getPayment = vi.spyOn(api, 'getPayment').mockResolvedValueOnce(payment('PROCESSING')).mockResolvedValue(payment('FAILED'));
    const { onPaymentProblem, onActive } = setup({ paymentId: 'p1' });

    await waitFor(() => expect(onPaymentProblem).toHaveBeenCalledTimes(1));
    expect(getPayment).toHaveBeenCalledWith('tok', 'p1');
    expect(onActive).not.toHaveBeenCalled();
  });

  it('ends the session when the token is no longer accepted', async () => {
    vi.spyOn(api, 'onboardingStatus').mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Unauthorized'));
    const { onSessionExpired } = setup();

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
  });
});
