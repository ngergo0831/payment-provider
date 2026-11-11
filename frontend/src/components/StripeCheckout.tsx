import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { type FormEvent, useEffect, useState } from 'react';

// `<Elements>` needs a stable `stripe` per key, so one instance lives for the whole page.
// A failed load is only retried by reloading.
const stripeByKey: Record<string, Promise<Stripe | null>> = {};

interface Props {
  publishableKey: string;
  clientSecret: string;
  onSubmitted: () => void;
}

export function StripeCheckout({ publishableKey, clientSecret, onSubmitted }: Props) {
  const stripePromise = (stripeByKey[publishableKey] ??= loadStripe(publishableKey));
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let current = true;
    const failed = () => current && setLoadFailed(true);
    stripePromise.then((stripe) => stripe || failed(), failed);
    return () => {
      current = false;
    };
  }, [stripePromise]);

  if (loadFailed) {
    return (
      <p role="alert" className="form-error">
        The secure card form could not be loaded. Check your connection or disable content blockers for this page, then reload.
      </p>
    );
  }
  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <CardForm onSubmitted={onSubmitted} />
    </Elements>
  );
}

function CardForm({ onSubmitted }: { onSubmitted: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required',
      });
      if (error) setMessage(error.message ?? 'The payment could not be completed.');
      else onSubmitted();
    } catch {
      setMessage('The payment could not be completed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} aria-label="Card payment">
      <PaymentElement />
      {message && <p role="alert" className="form-error">{message}</p>}
      <div className="actions">
        <button type="submit" disabled={!stripe || busy}>
          {busy ? 'Processing…' : 'Pay'}
        </button>
      </div>
    </form>
  );
}
