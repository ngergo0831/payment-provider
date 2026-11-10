export interface Session {
  token: string;
  companyName: string;
  email: string;
}

const KEY = 'payment-service.session';

export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    const stored: Partial<Session> | null = raw ? JSON.parse(raw) : null;
    return typeof stored?.token === 'string' && typeof stored.companyName === 'string' && typeof stored.email === 'string'
      ? { token: stored.token, companyName: stored.companyName, email: stored.email }
      : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    void 0;
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    void 0;
  }
}
