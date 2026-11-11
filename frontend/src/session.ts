export interface Session {
  token: string;
  companyName: string;
}

const KEY = 'payment-service.session';

// Storage can be blocked (private windows, strict settings): the session then just does not survive a reload.

export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<Session> | null) : null;
    return typeof stored?.token === 'string' && typeof stored.companyName === 'string'
      ? { token: stored.token, companyName: stored.companyName }
      : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    return;
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    return;
  }
}
