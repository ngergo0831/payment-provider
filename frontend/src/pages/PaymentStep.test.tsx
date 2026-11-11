import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api/client';
import type { CheckoutConfig, Payment, PaymentCheckout } from '../api/types';
import { formatMoney } from '../format';
import { PaymentStep } from './PaymentStep';

const confirmPayment = vi.fn();
vi.mock('@stripe/stripe-js', () => ({ loadStripe: vi.fn(async () => ({})) }));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: ReactNode }) => <>{children}</>,
  PaymentElement: () => <div>card form</div>,
  useStripe: () => ({ confirmPayment }),
  useElements: () => ({}),
}));

const session = { token: 'tok', companyName: 'Acme' };
const price = { amountMinor: 4900, currency: 'USD' };
const mockConfig: CheckoutConfig = { provider: 'mock', publishableKey: null, price };
// Locale-dependent, and may contain a non-breaking space, which the DOM matcher folds into a plain one.
const priceText = formatMoney(price).replace(/\s/g, ' ');
const stripeConfig: CheckoutConfig = { provider: 'stripe', publishableKey: 'pk_test_x', price };

const payment = (overrides: Partial<Payment> = {}): Payment => ({
  id: 'p1',
  status: 'CREATED',
  amount: price,
  failureCode: null,
  providerRef: 'mock_pi_1',
  createdAt: '2026-11-09T12:00:00Z',
  ...overrides,
});
const checkout = (paymentOverrides: Partial<Payment> = {}, clientSecret: string | null = 'secret_1'): PaymentCheckout => ({
  payment: payment(paymentOverrides),
  clientSecret,
});

beforeEach(() => confirmPayment.mockReset());
afterEach(() => vi.restoreAllMocks());

// `startPayment` answers in order and the last answer repeats; set up before rendering, as the screen asks on mount.
type Answer = PaymentCheckout | Error;

function setup(config: CheckoutConfig, ...answers: Answer[]) {
  vi.spyOn(api, 'checkoutConfig').mockResolvedValue(config);
  const start = vi.spyOn(api, 'startPayment');
  answers.forEach((answer, i) => {
    const respond = () => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer));
    if (i === answers.length - 1) start.mockImplementation(respond);
    else start.mockImplementationOnce(respond);
  });
  const onSubmitted = vi.fn();
  const onAlreadyActive = vi.fn();
  const onSessionExpired = vi.fn();
  render(<PaymentStep session={session} onSubmitted={onSubmitted} onAlreadyActive={onAlreadyActive} onSessionExpired={onSessionExpired} />);
  return { onSubmitted, onAlreadyActive, onSessionExpired, start };
}

describe('PaymentStep with the mock provider', () => {
  it('shows the price and the demo panel, and starts the payment with the session token', async () => {
    const { start } = setup(mockConfig, checkout());

    expect(await screen.findByText(priceText)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay successfully' })).toBeInTheDocument();
    expect(start).toHaveBeenCalledWith('tok');
  });

  it('"Pay successfully" tells the provider, then hands over to the activation watcher', async () => {
    const simulate = vi.spyOn(api, 'simulatePayment').mockResolvedValue({ webhook: 'PROCESSED' });
    const { onSubmitted } = setup(mockConfig, checkout());

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Pay successfully' }));

    expect(simulate).toHaveBeenCalledWith('mock_pi_1', 'succeed', true);
    expect(onSubmitted).toHaveBeenCalledWith('p1');
  });

  it('ignores a double click: the provider is told once while the first call is in flight', async () => {
    let finish: (value: { webhook: string }) => void = () => undefined;
    const simulate = vi.spyOn(api, 'simulatePayment').mockReturnValue(new Promise((resolve) => (finish = resolve)));
    setup(mockConfig, checkout());
    const user = userEvent.setup();

    const pay = await screen.findByRole('button', { name: 'Pay successfully' });
    await user.dblClick(pay);

    expect(pay).toBeDisabled();
    expect(simulate).toHaveBeenCalledTimes(1);
    finish({ webhook: 'PROCESSED' });
  });

  it('can lose the webhook on purpose', async () => {
    const simulate = vi.spyOn(api, 'simulatePayment').mockResolvedValue({ webhook: 'NOT_DELIVERED' });
    setup(mockConfig, checkout());
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText(/Lose the provider's webhook/));
    await user.click(screen.getByRole('button', { name: 'Pay successfully' }));

    expect(simulate).toHaveBeenCalledWith('mock_pi_1', 'succeed', false);
  });

  it('after a decline it reloads the payment and says the attempt failed, with the reason', async () => {
    vi.spyOn(api, 'simulatePayment').mockResolvedValue({ webhook: 'PROCESSED' });
    const { onSubmitted } = setup(mockConfig, checkout(), checkout({ status: 'FAILED', failureCode: 'card_declined' }));

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Decline the card' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your last attempt failed (card declined). Nothing was charged');
    expect(onSubmitted).not.toHaveBeenCalled();
  });
});

describe('PaymentStep with Stripe', () => {
  it('confirms the payment with Stripe, then hands over to the activation watcher', async () => {
    confirmPayment.mockResolvedValue({});
    const { onSubmitted } = setup(stripeConfig, checkout({ providerRef: 'pi_1' }));

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Pay' }));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    expect(confirmPayment).toHaveBeenCalledWith(expect.objectContaining({ redirect: 'if_required' }));
  });

  it("shows Stripe's message when the card is declined, and stays on the form to try again", async () => {
    confirmPayment.mockResolvedValue({ error: { message: 'Your card was declined.' } });
    const { onSubmitted } = setup(stripeConfig, checkout({ providerRef: 'pi_1' }));

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Pay' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your card was declined.');
    expect(screen.getByRole('button', { name: 'Pay' })).toBeEnabled();
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it('does not stay stuck on "Processing…" when confirming the payment throws', async () => {
    confirmPayment.mockRejectedValueOnce(new Error('network down'));
    const { onSubmitted } = setup(stripeConfig, checkout({ providerRef: 'pi_1' }));

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Pay' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The payment could not be completed');
    expect(screen.getByRole('button', { name: 'Pay' })).toBeEnabled();
    expect(onSubmitted).not.toHaveBeenCalled();
  });
});

describe('PaymentStep when things are not straightforward', () => {
  it('goes straight to the watcher if the payment is already in progress (page reload mid-payment)', async () => {
    const { onSubmitted } = setup(stripeConfig, checkout({ status: 'PROCESSING' }, null));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
  });

  it('reports an already active company (paid in another tab) so the app can go straight to the end', async () => {
    const { onAlreadyActive, onSubmitted } = setup(mockConfig, new ApiError(409, 'COMPANY_ALREADY_ACTIVE', 'This account is already active'));

    await waitFor(() => expect(onAlreadyActive).toHaveBeenCalledTimes(1));
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it('shows an error with "Try again" instead of an endless spinner when something unexpected is thrown', async () => {
    setup(mockConfig, new TypeError('boom'), checkout());

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText(priceText)).toBeInTheDocument();
  });

  it('does not report anything once the screen is gone (e.g. "Start over" while it was still loading)', async () => {
    let fail: (error: Error) => void = () => undefined;
    vi.spyOn(api, 'checkoutConfig').mockResolvedValue(mockConfig);
    vi.spyOn(api, 'startPayment').mockReturnValue(new Promise((_resolve, reject) => (fail = reject)));
    const onSessionExpired = vi.fn();
    const { unmount } = render(<PaymentStep session={session} onSubmitted={vi.fn()} onAlreadyActive={vi.fn()} onSessionExpired={onSessionExpired} />);

    unmount();
    fail(new ApiError(401, 'UNAUTHORIZED', 'Unauthorized'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('ends the session when the token has expired, instead of offering a "Try again" that can never work', async () => {
    const { onSessionExpired, onSubmitted } = setup(mockConfig, new ApiError(401, 'UNAUTHORIZED', 'Unauthorized'));

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('explains a provider outage, shows the request reference, and recovers on "Try again"', async () => {
    const outage = new ApiError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'The payment service is temporarily unavailable. Nothing was charged.', [], 'req-42');
    setup(mockConfig, outage, checkout());

    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was charged');
    expect(screen.getByText('Reference: req-42')).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText(priceText)).toBeInTheDocument();
  });

  it('lets the demo user switch the simulated outage off, even after "Try again" rebuilt the screen', async () => {
    const setOutage = vi.spyOn(api, 'setMockOutage').mockResolvedValueOnce({ outage: true }).mockResolvedValueOnce({ outage: false });
    setup(mockConfig, new ApiError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'The payment service is temporarily unavailable.'));
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Simulate a provider outage'));
    expect(setOutage).toHaveBeenLastCalledWith(true);

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    const toggle = await screen.findByLabelText('Simulate a provider outage');
    expect(toggle).toBeChecked();

    await user.click(toggle);
    expect(setOutage).toHaveBeenLastCalledWith(false);
  });
});
