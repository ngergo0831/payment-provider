import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StripeCheckout } from './StripeCheckout';

const loadStripe = vi.fn();
vi.mock('@stripe/stripe-js', () => ({ loadStripe: (key: string) => loadStripe(key) }));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: ReactNode }) => <>{children}</>,
  PaymentElement: () => <div>card form</div>,
  useStripe: () => ({}),
  useElements: () => ({}),
}));

afterEach(() => loadStripe.mockReset());

describe('StripeCheckout when Stripe.js cannot be loaded (content blocker, flaky network)', () => {
  it('explains it instead of leaving a dead form', async () => {
    loadStripe.mockRejectedValue(new Error('Failed to load Stripe.js'));

    render(<StripeCheckout publishableKey="pk_test_blocked" clientSecret="s" onSubmitted={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('The secure card form could not be loaded');
  });

  it('does not remember the failure: after a reload the same key can load', async () => {
    loadStripe.mockRejectedValueOnce(new Error('blocked')).mockResolvedValue({});
    const first = render(<StripeCheckout publishableKey="pk_test_retry" clientSecret="s" onSubmitted={vi.fn()} />);
    await screen.findByRole('alert');
    first.unmount();

    render(<StripeCheckout publishableKey="pk_test_retry" clientSecret="s" onSubmitted={vi.fn()} />);

    expect(await screen.findByText('card form')).toBeInTheDocument();
    expect(loadStripe).toHaveBeenCalledTimes(2);
  });

  it('shows the card form when it loads', async () => {
    loadStripe.mockResolvedValue({});

    render(<StripeCheckout publishableKey="pk_test_ok" clientSecret="s" onSubmitted={vi.fn()} />);

    expect(await screen.findByText('card form')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
