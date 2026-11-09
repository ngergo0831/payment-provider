import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { Session } from '../session';
import { useActivationWatcher } from '../useActivationWatcher';

interface Props {
  session: Session;
  paymentId?: string;
  onActive: () => void;
  onPaymentProblem: () => void;
  onSessionExpired: () => void;
  intervalMs?: number;
  slowAfterMs?: number;
}

export function ActivationWatcher({ session, paymentId, onActive, onPaymentProblem, onSessionExpired, intervalMs, slowAfterMs }: Props) {
  const { outcome, offline, slow } = useActivationWatcher({ token: session.token, paymentId, intervalMs, slowAfterMs });
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string>();

  useEffect(() => {
    if (outcome === 'active') onActive();
    else if (outcome === 'payment_problem') onPaymentProblem();
    else if (outcome === 'expired') onSessionExpired();
  }, [outcome, onActive, onPaymentProblem, onSessionExpired]);

  /**
   * Resuming checkout makes the backend ask the provider for the payment's real state, which is the recovery for a
   * lost webhook (the safety-net job would also find it, but only after a few minutes).
   */
  async function checkAgain() {
    setChecking(true);
    setCheckError(undefined);
    try {
      const { payment } = await api.startPayment(session.token);
      if (payment.status !== 'PROCESSING' && payment.status !== 'SUCCEEDED') onPaymentProblem();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'COMPANY_ALREADY_ACTIVE') return;
      if (error instanceof ApiError && error.status === 401) return onSessionExpired();
      setCheckError(error instanceof ApiError ? error.message : 'Unexpected error');
    } finally {
      setChecking(false);
    }
  }

  return (
    <section aria-live="polite">
      <h2>Payment received</h2>
      <p aria-busy="true">Activating your account… this usually takes a few seconds.</p>

      {offline && (
        <p role="alert" className="form-error">
          We can't reach the service right now. Your payment is safe; we keep trying and will continue automatically as soon as it is back.
        </p>
      )}

      {slow && !offline && (
        <>
          <p className="hint">
            This is taking longer than usual. Your payment is safe: confirmation from the bank can be delayed, and we keep checking.
          </p>
          <div className="actions">
            <button type="button" className="secondary" onClick={() => void checkAgain()} disabled={checking}>
              {checking ? 'Checking…' : 'Check again now'}
            </button>
          </div>
          {checkError && <p role="alert" className="form-error">{checkError}</p>}
        </>
      )}
    </section>
  );
}
