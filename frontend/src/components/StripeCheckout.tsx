import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { type FormEvent, useState } from 'react';

// loadStripe injects Stripe's script: call it once per key, not on every render.
const stripeByKey = new Map<string, Promise<Stripe | null>>();
function stripeFor(publishableKey: string) {
  if (!stripeByKey.has(publishableKey)) stripeByKey.set(publishableKey, loadStripe(publishableKey));
  return stripeByKey.get(publishableKey)!;
}

interface Props {
  publishableKey: string;
  clientSecret: string;
  /** Stripe accepted the payment details (it may still be processing). The backend learns the result by webhook. */
  onSubmitted: () => void;
}

/** Stripe collects the card details in its own iframe: card numbers never touch our page or our server. */
export function StripeCheckout({ publishableKey, clientSecret, onSubmitted }: Props) {
  return (
    <Elements stripe={stripeFor(publishableKey)} options={{ clientSecret }}>
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
    // 'if_required': card payments finish here (3-D Secure opens Stripe's own dialog); only redirect-based methods leave the page.
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    });
    if (error) {
      // e.g. "Your card was declined." The element stays open, so the customer can try another card.
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
