import { useEffect, useState } from 'react';
import { api, ApiError } from './api/client';

const POLL_INTERVAL_MS = 2000;
const SLOW_AFTER_MS = 15_000;

type WatchOutcome =
  | 'waiting'
  /** The company is ACTIVE: onboarding is complete. */
  | 'active'
  /** The payment ended as FAILED or CANCELED after it was submitted: the customer has to pay again. */
  | 'payment_problem'
  /** The token is no longer accepted. */
  | 'expired';

interface Watch {
  outcome: WatchOutcome;
  offline: boolean;
  slow: boolean;
}

interface Options {
  token: string;
  paymentId?: string;
  intervalMs?: number;
  slowAfterMs?: number;
}

const FAILED_AFTER_SUBMIT = new Set(['FAILED', 'CANCELED']);

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
