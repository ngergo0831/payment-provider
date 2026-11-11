import { useCallback, useState } from 'react';
import { ActivationWatcher } from './pages/ActivationWatcher';
import { PaymentStep } from './pages/PaymentStep';
import { RegisterPage } from './pages/RegisterPage';
import { SuccessScreen } from './pages/SuccessScreen';
import { clearSession, loadSession, saveSession, type Session } from './session';

// A reload resumes at `payment`: the backend works out the real state.
type Step = { name: 'payment' } | { name: 'activating'; paymentId: string } | { name: 'done' };

const PAYMENT: Step = { name: 'payment' };
const DONE: Step = { name: 'done' };

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [step, setStep] = useState<Step>(PAYMENT);
  const [notice, setNotice] = useState<string>();

  const onRegistered = (next: Session) => {
    saveSession(next);
    setNotice(undefined);
    setSession(next);
  };

  const signOut = useCallback((reason?: string) => {
    clearSession();
    setSession(null);
    setStep(PAYMENT);
    setNotice(reason);
  }, []);

  const onSubmitted = useCallback((paymentId: string) => setStep({ name: 'activating', paymentId }), []);
  const onActive = useCallback(() => setStep(DONE), []);
  const backToPayment = useCallback(() => setStep(PAYMENT), []);
  const onSessionExpired = useCallback(() => signOut('Your session expired. Please register again.'), [signOut]);

  return (
    <main>
      <header>
        <h1>Payment Service</h1>
        {session && (
          <button type="button" className="link" onClick={() => signOut()}>
            Start over
          </button>
        )}
      </header>

      {notice && <p role="status" className="hint">{notice}</p>}

      {!session ? (
        <RegisterPage onRegistered={onRegistered} />
      ) : step.name === 'payment' ? (
        <PaymentStep session={session} onSubmitted={onSubmitted} onAlreadyActive={onActive} onSessionExpired={onSessionExpired} />
      ) : step.name === 'activating' ? (
        <ActivationWatcher
          session={session}
          paymentId={step.paymentId}
          onActive={onActive}
          onPaymentProblem={backToPayment}
          onSessionExpired={onSessionExpired}
        />
      ) : (
        <SuccessScreen session={session} />
      )}
    </main>
  );
}
