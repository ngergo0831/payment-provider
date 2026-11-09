import { useState } from 'react';
import { PaymentStep } from './pages/PaymentStep';
import { RegisterPage } from './pages/RegisterPage';
import { clearSession, loadSession, saveSession, type Session } from './session';

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [submitted, setSubmitted] = useState(false);

  function onRegistered(next: Session) {
    saveSession(next);
    setSession(next);
  }

  function signOut() {
    clearSession();
    setSession(null);
    setSubmitted(false);
  }

  return (
    <main>
      <header>
        <h1>Payment Service</h1>
        {session && (
          <button type="button" className="link" onClick={signOut}>
            Start over
          </button>
        )}
      </header>
      {!session ? (
        <RegisterPage onRegistered={onRegistered} />
      ) : submitted ? (
        <p>Payment submitted. Activating your account…</p>
      ) : (
        <PaymentStep session={session} onSubmitted={() => setSubmitted(true)} />
      )}
    </main>
  );
}
