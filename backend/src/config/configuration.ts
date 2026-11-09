import { LogFormat } from '../common/logging/console-log-sink';
import { LogLevelName } from '../common/logging/app-logger';
import { Environment, PaymentProviderName, validateEnv } from './env.validation';

/** The typed, structured view of configuration the rest of the app depends on. */
export interface AppConfig {
  nodeEnv: Environment;
  logLevel: LogLevelName;
  logFormat: LogFormat;
  port: number;
  database: {
    /** Contains the password: pass it to the driver, never log it. */
    url: string;
  };
  jwt: {
    /** Signing key. Never log it. */
    secret: string;
    /** e.g. "24h". */
    expiresIn: string;
  };
  payments: {
    provider: PaymentProviderName;
    /** Only filled in when the provider is Stripe. The secret key and webhook secret must never be logged or returned. */
    stripe: { secretKey: string; publishableKey: string; webhookSecret: string };
    /** The single plan on sale. Already validated as a real amount by Money. */
    plan: { priceMinor: number; currency: string };
    /** Milliseconds between outbox deliveries; 0 = timer off. */
    outboxPollIntervalMs: number;
    /** Milliseconds between reconciliation runs; 0 = timer off. */
    reconcileIntervalMs: number;
  };
}

/**
 * Validates the environment, then maps flat variables to the structured AppConfig.
 * Runs once at startup (ConfigModule `load`): an invalid environment throws here and the process exits.
 */
export const configuration = (): AppConfig => {
  const env = validateEnv(process.env);
  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    logFormat: env.LOG_FORMAT,
    port: env.PORT,
    database: { url: env.DATABASE_URL },
    jwt: { secret: env.JWT_SECRET, expiresIn: env.JWT_EXPIRES_IN },
    payments: {
      provider: env.PAYMENT_PROVIDER,
      stripe: {
        secretKey: env.STRIPE_SECRET_KEY ?? '',
        publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? '',
        webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? '',
      },
      plan: { priceMinor: env.PLAN_PRICE_MINOR, currency: env.PLAN_CURRENCY.toUpperCase() },
      outboxPollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
      reconcileIntervalMs: env.RECONCILE_INTERVAL_MS,
    },
  };
};
