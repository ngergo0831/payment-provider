import { useState } from 'react';
import { api, toApiError } from '../api/client';
import { isSubmitted } from '../api/types';
import type { Session } from '../session';
import { useActivationWatcher } from '../useActivationWatcher';

interface Props {
  session: Session;
  paymentId: string;
  onActive: () => void;
  onPaymentProblem: () => void;
  onSessionExpired: () => void;
}

export function ActivationWatcher({ session, paymentId, onActive, onPaymentProblem, onSessionExpired }: Props) {
  const { offline, slow } = useActivationWatcher({ token: session.token, paymentId, onActive, onPaymentProblem, onSessionExpired });
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string>();

  async function checkAgain() {
    setChecking(true);
    setCheckError(undefined);
    try {
      const { payment } = await api.startPayment(session.token);
      if (!isSubmitted(payment.status)) onPaymentProblem();
    } catch (e) {
      const error = toApiError(e);
      if (error.code === 'COMPANY_ALREADY_ACTIVE') return;
      if (error.status === 401) return onSessionExpired();
      setCheckError(error.message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="card" aria-live="polite">
      <h2>Payment received</h2>
      <p>Activating your account… this usually takes a few seconds.</p>

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
