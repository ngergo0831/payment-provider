import { LogFormat, LogLevelName } from '../common/logging/app-logger';
import { Environment, PaymentProviderName, validateEnv } from './env.validation';

export interface AppConfig {
  nodeEnv: Environment;
  logLevel: LogLevelName;
  logFormat: LogFormat;
  port: number;
  rateLimitPerMinute: number;
  database: {
    url: string;
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  payments: {
    provider: PaymentProviderName;
    stripe: { secretKey: string; publishableKey: string; webhookSecret: string };
    plan: { priceMinor: number; currency: string };
    outboxPollIntervalMs: number;
    reconcileIntervalMs: number;
  };
}

export const configuration = (): AppConfig => {
  const env = validateEnv(process.env);
  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    logFormat: env.LOG_FORMAT,
    port: env.PORT,
    rateLimitPerMinute: env.RATE_LIMIT_PER_MINUTE,
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
