import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, loadSession, saveSession } from './session';

const KEY = 'payment-service.session';
const session = { token: 'tok', companyName: 'Acme' };

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('session storage', () => {
  it('remembers a session and forgets it again', () => {
    saveSession(session);
    expect(loadSession()).toEqual(session);

    clearSession();
    expect(loadSession()).toBeNull();
  });

  it.each([
    ['not JSON', 'definitely not json'],
    ['missing the token', JSON.stringify({ companyName: 'Acme' })],
    ['a token of the wrong type', JSON.stringify({ ...session, token: 42 })],
    ['not an object', JSON.stringify('hello')],
    ['null', 'null'],
  ])('ignores stored data that is %s, instead of crashing or sending "Bearer undefined"', (_label, raw) => {
    sessionStorage.setItem(KEY, raw);
    expect(loadSession()).toBeNull();
  });

  it('keeps working when the browser blocks storage (private windows, strict settings)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    expect(loadSession()).toBeNull();
    expect(() => saveSession(session)).not.toThrow();
    expect(() => clearSession()).not.toThrow();
  });
});
