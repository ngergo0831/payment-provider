import { useEffect, useState } from 'react';
import { api, toApiError } from './api/client';
import { isFailed } from './api/types';

const POLL_INTERVAL_MS = 2000;
const SLOW_AFTER_MS = 15_000;

interface Watch {
  offline: boolean;
  slow: boolean;
}

interface Options {
  token: string;
  paymentId: string;
  onActive: () => void;
  onPaymentProblem: () => void;
  onSessionExpired: () => void;
}

export function useActivationWatcher({ token, paymentId, onActive, onPaymentProblem, onSessionExpired }: Options): Watch {
  const [watch, setWatch] = useState<Watch>({ offline: false, slow: false });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const startedAt = Date.now();

    const report = (offline: boolean) => {
      const slow = Date.now() - startedAt >= SLOW_AFTER_MS;
      setWatch((w) => (w.offline === offline && w.slow === slow ? w : { offline, slow }));
    };

    async function poll() {
      try {
        const { company } = await api.onboardingStatus(token);
        if (cancelled) return;
        if (company.status === 'ACTIVE') return onActive();

        const payment = await api.getPayment(token, paymentId);
        if (cancelled) return;
        if (isFailed(payment.status)) return onPaymentProblem();
        report(false);
      } catch (e) {
        if (cancelled) return;
        const error = toApiError(e);
        if (error.status === 401) return onSessionExpired();
        report(error.unreachable);
      }
      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    }

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, paymentId, onActive, onPaymentProblem, onSessionExpired]);

  return watch;
}
