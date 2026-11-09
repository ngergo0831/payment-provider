import { useState } from 'react';
import { RegisterPage } from './pages/RegisterPage';
import { clearSession, loadSession, saveSession, type Session } from './session';

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession);

  function onRegistered(next: Session) {
    saveSession(next);
    setSession(next);
  }

  function signOut() {
    clearSession();
    setSession(null);
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
      {session ? <p>Welcome, {session.companyName}. The payment step comes next.</p> : <RegisterPage onRegistered={onRegistered} />}
    </main>
  );
}
