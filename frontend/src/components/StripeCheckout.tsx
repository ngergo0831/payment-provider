import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { type FormEvent, useEffect, useState } from 'react';

const stripeByKey = new Map<string, Promise<Stripe | null>>();
function stripeFor(publishableKey: string) {
  if (!stripeByKey.has(publishableKey)) stripeByKey.set(publishableKey, loadStripe(publishableKey));
  return stripeByKey.get(publishableKey)!;
}

interface Props {
  publishableKey: string;
  clientSecret: string;
  onSubmitted: () => void;
}

/** Stripe collects the card details in its own iframe: card numbers never touch our page or our server. */
export function StripeCheckout({ publishableKey, clientSecret, onSubmitted }: Props) {
  const stripePromise = stripeFor(publishableKey);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let current = true;
    const failed = () => {
      stripeByKey.delete(publishableKey);
      if (current) setLoadFailed(true);
    };
    stripePromise.then((stripe) => stripe || failed(), failed);
    return () => {
      current = false;
    };
  }, [stripePromise, publishableKey]);

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
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    });
    if (error) {
      setMessage(error.message ?? 'The payment could not be completed.');
      setBusy(false);
    } else {
      onSubmitted();
    }
  }

  return (
    <form onSubmit={submit} aria-label="Card payment">
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
