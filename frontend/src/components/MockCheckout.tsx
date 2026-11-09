import { useState } from 'react';
import { api, ApiError } from '../api/client';
import type { MockOutcome } from '../api/types';

interface Props {
  providerRef: string;
  /** The customer/bank acted and the payment is moving towards a result: start watching for activation. */
  onSubmitted: () => void;
  /** The payment changed in a way the customer must react to (declined, 3-D Secure, canceled): show the new state. */
  onNeedsAttention: () => void;
}

const ACTIONS: { outcome: MockOutcome; label: string; settles: boolean }[] = [
  { outcome: 'succeed', label: 'Pay successfully', settles: true },
  { outcome: 'processing', label: 'Bank is slow (processing)', settles: true },
  { outcome: 'decline', label: 'Decline the card', settles: false },
  { outcome: 'require_action', label: 'Ask for 3-D Secure', settles: false },
  { outcome: 'cancel', label: 'Abandon the payment', settles: false },
];

/** No Stripe keys: this panel plays "the customer and their bank", so every scenario can be shown without a card. */
export function MockCheckout({ providerRef, onSubmitted, onNeedsAttention }: Props) {
  const [loseWebhook, setLoseWebhook] = useState(false);
  const [error, setError] = useState<string>();

  async function act(outcome: MockOutcome, settles: boolean) {
    setError(undefined);
    try {
      await api.simulatePayment(providerRef, outcome, !loseWebhook);
      (settles ? onSubmitted : onNeedsAttention)();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Unexpected error');
    }
  }

  return (
    <section aria-label="Mock payment">
      <p className="hint">
        <strong>Demo mode:</strong> no payment provider keys are configured, so you play the customer and the bank.
      </p>
      <div className="actions wrap">
        {ACTIONS.map(({ outcome, label, settles }) => (
          <button key={outcome} type="button" className={settles ? undefined : 'secondary'} onClick={() => act(outcome, settles)}>
            {label}
          </button>
        ))}
      </div>
      <label className="check">
        <input type="checkbox" checked={loseWebhook} onChange={(e) => setLoseWebhook(e.target.checked)} />
        Lose the provider's webhook (the safety-net job recovers it)
      </label>
      <OutageToggle />
      {error && <p role="alert" className="form-error">{error}</p>}
    </section>
  );
}

/** Switches the fake provider "off", to show how the system behaves when the payment provider is down. */
export function OutageToggle() {
  const [outage, setOutage] = useState(false);
  const [error, setError] = useState<string>();

  async function toggle(enabled: boolean) {
    try {
      setOutage((await api.setMockOutage(enabled)).outage);
      setError(undefined);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Unexpected error');
    }
  }

  return (
    <>
      <label className="check">
        <input type="checkbox" checked={outage} onChange={(e) => toggle(e.target.checked)} />
        Simulate a provider outage
      </label>
      {error && <p role="alert" className="form-error">{error}</p>}
    </>
  );
}
