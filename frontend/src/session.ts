/** What we remember about the signed-in admin between page reloads. The token is the only secret in it. */
export interface Session {
  token: string;
  companyName: string;
  email: string;
}

const KEY = 'payment-service.session';

// sessionStorage (not localStorage): the session ends with the tab. Every access is guarded, because storage can be
// blocked (private windows, strict browser settings); the app then simply works without remembering anything.
export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* not remembered: fine */
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
