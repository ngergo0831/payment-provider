import { useCallback, useState } from 'react';
import { ActivationWatcher } from './pages/ActivationWatcher';
import { PaymentStep } from './pages/PaymentStep';
import { RegisterPage } from './pages/RegisterPage';
import { SuccessScreen } from './pages/SuccessScreen';
import { clearSession, loadSession, saveSession, type Session } from './session';

/** Where the admin is in onboarding. (A reload resumes at `payment`: the backend works out the real state.) */
type Step = { name: 'payment' } | { name: 'activating'; paymentId?: string } | { name: 'done' };

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [step, setStep] = useState<Step>({ name: 'payment' });
  const [notice, setNotice] = useState<string>();

  const onRegistered = (next: Session) => {
    saveSession(next);
    setNotice(undefined);
    setStep({ name: 'payment' });
    setSession(next);
  };

  const signOut = useCallback((reason?: string) => {
    clearSession();
    setSession(null);
    setNotice(reason);
  }, []);

  const onActive = useCallback(() => setStep({ name: 'done' }), []);
  const backToPayment = useCallback(() => setStep({ name: 'payment' }), []);
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
        <PaymentStep
          session={session}
          onSubmitted={(paymentId) => setStep({ name: 'activating', paymentId })}
          onSessionExpired={onSessionExpired}
        />
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
