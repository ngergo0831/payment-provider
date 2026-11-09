import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { CheckoutConfig, PaymentCheckout } from '../api/types';
import { MockCheckout, OutageToggle } from '../components/MockCheckout';
import { StripeCheckout } from '../components/StripeCheckout';
import { formatMoney } from '../format';
import type { Session } from '../session';

interface Props {
  session: Session;
  /** The payment went through on the customer's side; what remains is waiting for the company to be activated. */
  onSubmitted: () => void;
}

type State =
  | { phase: 'loading' }
  | { phase: 'error'; error: ApiError; config?: CheckoutConfig }
  | { phase: 'ready'; config: CheckoutConfig; checkout: PaymentCheckout };

/** Statuses where there is nothing left for the customer to do here, e.g. after a page reload mid-payment. */
const SUBMITTED = new Set(['PROCESSING', 'SUCCEEDED']);

export function PaymentStep({ session, onSubmitted }: Props) {
  const [state, setState] = useState<State>({ phase: 'loading' });
  // Read through a ref, so a parent passing a new function every render cannot make us reload the payment in a loop.
  const onSubmittedRef = useRef(onSubmitted);
  useEffect(() => {
    onSubmittedRef.current = onSubmitted;
  });

  // Safe to run any number of times: the backend resumes the company's one open payment instead of creating another.
  const load = useCallback(async () => {
    setState({ phase: 'loading' });
    let config: CheckoutConfig | undefined;
    try {
      config = await api.checkoutConfig();
      const checkout = await api.startPayment(session.token);
      if (SUBMITTED.has(checkout.payment.status)) onSubmittedRef.current();
      else setState({ phase: 'ready', config, checkout });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.code === 'COMPANY_ALREADY_ACTIVE') onSubmittedRef.current(); // paid in another tab: the watcher will see ACTIVE
      else setState({ phase: 'error', error, config });
    }
  }, [session.token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.phase === 'loading') return <p aria-busy="true">Preparing your payment…</p>;

  if (state.phase === 'error') {
    return (
      <section>
        <p role="alert" className="form-error">{state.error.message}</p>
        {state.error.requestId && <p className="hint">Reference: {state.error.requestId}</p>}
        <div className="actions">
          <button type="button" onClick={() => void load()}>
            Try again
          </button>
        </div>
        {state.config?.provider === 'mock' && <OutageToggle />}
      </section>
    );
  }

  const { config, checkout } = state;
  const { payment, clientSecret } = checkout;
  return (
    <section>
      <h2>Pay for your plan</h2>
      <p className="price">{formatMoney(config.price)}</p>

      {payment.status === 'FAILED' && (
        <p role="alert" className="form-error">
          Your last attempt failed{payment.failureCode ? ` (${payment.failureCode.replaceAll('_', ' ')})` : ''}. Nothing was charged: try again or use another card.
        </p>
      )}
      {payment.status === 'REQUIRES_ACTION' && <p className="hint">Your bank needs to verify this payment. Continue below to complete it.</p>}

      {config.provider === 'stripe' && config.publishableKey && clientSecret ? (
        <StripeCheckout publishableKey={config.publishableKey} clientSecret={clientSecret} onSubmitted={onSubmitted} />
      ) : config.provider === 'mock' && payment.providerRef ? (
        <MockCheckout providerRef={payment.providerRef} onSubmitted={onSubmitted} onNeedsAttention={() => void load()} />
      ) : (
        <p role="alert" className="form-error">Payments are not available right now.</p>
      )}
    </section>
  );
}
