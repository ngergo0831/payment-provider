import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { api, ApiError } from './api/client';
import type { Payment } from './api/types';

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

const price = { amountMinor: 4900, currency: 'USD' };
const payment = (status: Payment['status'] = 'CREATED'): Payment => ({
  id: 'p1',
  status,
  amount: price,
  failureCode: null,
  providerRef: 'mock_pi_1',
  createdAt: '2026-11-09T12:00:00Z',
});
const active = { company: { id: 'c1', name: 'Acme Kft', status: 'ACTIVE' as const, activatedAt: '2026-11-09T12:00:05Z' }, nextStep: 'DONE' as const };

function mockBackend() {
  vi.spyOn(api, 'register').mockResolvedValue({
    user: { id: 'u1', email: 'jane@acme.example', fullName: 'Jane Doe' },
    company: { id: 'c1', name: 'Acme Kft', status: 'PENDING_PAYMENT' },
    accessToken: 'tok',
  });
  vi.spyOn(api, 'checkoutConfig').mockResolvedValue({ provider: 'mock', publishableKey: null, price });
  vi.spyOn(api, 'startPayment').mockResolvedValue({ payment: payment(), clientSecret: 'secret' });
  vi.spyOn(api, 'simulatePayment').mockResolvedValue({ webhook: 'PROCESSED' });
  vi.spyOn(api, 'onboardingStatus').mockResolvedValue(active);
}

describe('App: the whole onboarding journey', () => {
  it('register -> pay -> activation -> success', async () => {
    mockBackend();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Fill sample data' }));
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await user.click(await screen.findByRole('button', { name: 'Pay successfully' }));

    expect(await screen.findByRole('heading', { name: /You're all set/ })).toBeInTheDocument();
    expect(screen.getByText('Acme Kft')).toBeInTheDocument();
  });

  it('resumes after a page reload: the saved session goes straight to the payment, nothing is registered twice', async () => {
    mockBackend();
    sessionStorage.setItem('payment-service.session', JSON.stringify({ token: 'tok', companyName: 'Acme Kft' }));

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Pay successfully' })).toBeInTheDocument();
    expect(api.register).not.toHaveBeenCalled();
  });

  it('"Start over" forgets the session and shows the registration form again', async () => {
    mockBackend();
    sessionStorage.setItem('payment-service.session', JSON.stringify({ token: 'tok', companyName: 'Acme Kft' }));
    render(<App />);

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Start over' }));

    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
    expect(sessionStorage.getItem('payment-service.session')).toBeNull();
  });

  it('goes straight to the success screen when the company is already active (paid in another tab)', async () => {
    mockBackend();
    vi.spyOn(api, 'startPayment').mockRejectedValue(new ApiError(409, 'COMPANY_ALREADY_ACTIVE', 'This account is already active'));
    sessionStorage.setItem('payment-service.session', JSON.stringify({ token: 'tok', companyName: 'Acme Kft' }));

    render(<App />);

    expect(await screen.findByRole('heading', { name: /You're all set/ })).toBeInTheDocument();
    expect(api.onboardingStatus).not.toHaveBeenCalled();
  });

  it('"Start over" while the payment is still loading does not bring back a stale "session expired" notice', async () => {
    mockBackend();
    let rejectStart: (error: unknown) => void = () => undefined;
    vi.spyOn(api, 'startPayment').mockReturnValue(new Promise((_resolve, reject) => (rejectStart = reject)));
    sessionStorage.setItem('payment-service.session', JSON.stringify({ token: 'tok', companyName: 'Acme Kft' }));
    render(<App />);

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Start over' }));
    await act(async () => rejectStart(new ApiError(401, 'UNAUTHORIZED', 'Unauthorized')));

    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
    expect(screen.queryByText(/session expired/)).not.toBeInTheDocument();
  });
});
