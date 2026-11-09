import { useEffect, useState } from 'react';
import { api, ApiError } from './api/client';

export const POLL_INTERVAL_MS = 2000;
/** After this long without an answer we stop saying "just a moment" and explain that it is taking longer. */
export const SLOW_AFTER_MS = 15_000;

export type WatchOutcome =
  | 'waiting'
  /** The company is ACTIVE: onboarding is complete. */
  | 'active'
  /** The payment ended as FAILED or CANCELED after it was submitted: the customer has to pay again. */
  | 'payment_problem'
  /** The token is no longer accepted. */
  | 'expired';

export interface Watch {
  outcome: WatchOutcome;
  /** The last request could not reach the API (we are offline, or it is down); we keep trying. */
  offline: boolean;
  slow: boolean;
}

interface Options {
  token: string;
  /** When known, also watch the payment itself, so a failure that happens AFTER submission is noticed. */
  paymentId?: string;
  intervalMs?: number;
  slowAfterMs?: number;
}

const FAILED_AFTER_SUBMIT = new Set(['FAILED', 'CANCELED']);

/**
 * Polls until the company becomes ACTIVE. Activation is asynchronous (webhook -> outbox -> activation), so the browser
 * cannot know the moment it happens: it asks. The next request starts only after the previous one finished, so a slow
 * server is never flooded.
 */
export function useActivationWatcher({ token, paymentId, intervalMs = POLL_INTERVAL_MS, slowAfterMs = SLOW_AFTER_MS }: Options): Watch {
  const [watch, setWatch] = useState<Watch>({ outcome: 'waiting', offline: false, slow: false });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const startedAt = Date.now();

    const finish = (outcome: WatchOutcome) => setWatch((w) => ({ ...w, outcome, offline: false }));

    async function poll() {
      try {
        const { company } = await api.onboardingStatus(token);
        if (cancelled) return;
        if (company.status === 'ACTIVE') return finish('active');

        if (paymentId) {
          const payment = await api.getPayment(token, paymentId);
          if (cancelled) return;
          if (FAILED_AFTER_SUBMIT.has(payment.status)) return finish('payment_problem');
        }
        setWatch({ outcome: 'waiting', offline: false, slow: Date.now() - startedAt >= slowAfterMs });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) return finish('expired');
        // We cannot reach the API (offline, or it is down/restarting): nothing is lost, the payment is safe, so keep asking.
        setWatch((w) => ({ ...w, offline: error instanceof ApiError && error.unreachable, slow: Date.now() - startedAt >= slowAfterMs }));
      }
      timer = setTimeout(poll, intervalMs);
    }

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, paymentId, intervalMs, slowAfterMs]);

  return watch;
}
