import { useEffect, useState } from 'react';
import { api, ApiError } from './api/client';
import type { CheckoutConfig } from './api/types';

/** Skeleton only: proves the browser -> /api proxy -> backend path works. The real screens arrive in the next tasks. */
export function App() {
  const [config, setConfig] = useState<CheckoutConfig>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.checkoutConfig().then(setConfig, (e: ApiError) => setError(e.message));
  }, []);

  return (
    <main>
      <h1>Payment Service</h1>
      {error && <p role="alert">{error}</p>}
      {config && (
        <p>
          Plan: {(config.price.amountMinor / 100).toFixed(2)} {config.price.currency} · provider: {config.provider}
        </p>
      )}
    </main>
  );
}
