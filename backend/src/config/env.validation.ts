import { plainToInstance, Transform, Type } from 'class-transformer';
import { InvalidMoneyError, Money } from '../payments/domain/money';
import { IsEnum, IsInt, IsString, IsUrl, Matches, Max, Min, MinLength, ValidateIf, validateSync } from 'class-validator';

/** Every example secret in this repository starts with this, so production can refuse them. */
const DEV_SECRET_PREFIX = 'dev-only';

/** Which payment provider is used. Chosen once at startup. */
export enum PaymentProviderName {
  Mock = 'mock',
  Stripe = 'stripe',
}

export enum Environment {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/**
 * Every environment variable the app understands, with its type, rules and default.
 * This class is the single source of truth: add a variable here when a task needs one.
 */
export class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  // Environment variables are always strings; @Type converts "3000" to 3000 before validation.
  // Decorators are evaluated bottom-up, and we report only the first failure per variable,
  // so the most fundamental rule (@IsInt) goes LAST: "abc" then reads "must be an integer",
  // not the misleading "must not be greater than 65535".
  @Type(() => Number)
  @Max(65535)
  @Min(1)
  @IsInt()
  PORT: number = 3000;

  // Required, no default: a connection string carries credentials and must be supplied by the environment.
  // Validation messages name the variable, never its value, so the password cannot leak into error output.
  @IsUrl({ protocols: ['postgres', 'postgresql'], require_protocol: true, require_tld: false })
  DATABASE_URL: string;

  // HS256 needs a secret at least as long as its 256-bit output, or it is brute-forceable. Required, no default.
  @MinLength(32)
  JWT_SECRET: string;

  // How long a token stays valid: a number plus a unit (s, m, h, d), e.g. "30m" or "24h".
  @Matches(/^\d+[smhd]$/, { message: 'JWT_EXPIRES_IN must look like 30m, 24h or 7d' })
  JWT_EXPIRES_IN: string = '24h';

  // The one plan this slice sells, in MINOR units (4900 = 49.00 USD, 4900 = 4900 JPY). Whether the amount and
  // currency make sense TOGETHER is checked by Money in validateEnv, so a bad value stops the deploy.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  PLAN_PRICE_MINOR: number = 4900;

  @Matches(/^[A-Za-z]{3}$/, { message: 'PLAN_CURRENCY must be a 3-letter currency code such as USD' })
  PLAN_CURRENCY: string = 'USD';

  // 'mock' needs nothing and works out of the box. 'stripe' needs the three keys below.
  @IsEnum(PaymentProviderName)
  PAYMENT_PROVIDER: PaymentProviderName = PaymentProviderName.Mock;

  // Stripe settings are required ONLY when Stripe is the provider. Messages name the variable, never its value.
  @ValidateIf((env: EnvironmentVariables) => env.PAYMENT_PROVIDER === PaymentProviderName.Stripe)
  @Matches(/^sk_(test|live)_\S+$/, { message: 'STRIPE_SECRET_KEY must be a Stripe secret key (sk_test_... or sk_live_...)' })
  STRIPE_SECRET_KEY?: string;

  @ValidateIf((env: EnvironmentVariables) => env.PAYMENT_PROVIDER === PaymentProviderName.Stripe)
  @Matches(/^pk_(test|live)_\S+$/, { message: 'STRIPE_PUBLISHABLE_KEY must be a Stripe publishable key (pk_test_... or pk_live_...)' })
  STRIPE_PUBLISHABLE_KEY?: string;

  @ValidateIf((env: EnvironmentVariables) => env.PAYMENT_PROVIDER === PaymentProviderName.Stripe)
  @Matches(/^whsec_\S+$/, { message: 'STRIPE_WEBHOOK_SECRET must be a Stripe webhook signing secret (whsec_...)' })
  STRIPE_WEBHOOK_SECRET?: string;

  // How often queued outbox messages are delivered. 0 turns the timer off (tests trigger delivery themselves).
  // Number("") is 0, so an EMPTY variable would silently switch delivery off. Map it to NaN so it is rejected instead.
  @Transform(({ value }) => (value === '' ? NaN : Number(value)))
  @IsInt()
  @Min(0)
  OUTBOX_POLL_INTERVAL_MS: number = 1000;

  // How often payments that went quiet are compared with the provider (the safety net for lost webhooks). 0 = off.
  @Transform(({ value }) => (value === '' ? NaN : Number(value)))
  @IsInt()
  @Min(0)
  RECONCILE_INTERVAL_MS: number = 60000;
}

/**
 * Validates raw environment variables (normally `process.env`).
 * Reports ALL problems at once, so a misconfigured deploy is fixed in one go instead of one error per restart.
 */
export function validateEnv(raw: Record<string, unknown>): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, raw, { exposeDefaultValues: true });
  const errors = validateSync(env, { stopAtFirstError: true });

  if (errors.length > 0) {
    const problems = errors.flatMap((error) => Object.values(error.constraints ?? {}));
    throw new Error(`Invalid environment configuration:\n - ${problems.join('\n - ')}`);
  }

  // The price must be a real amount in a currency we know how to charge (explicit list, no guessing).
  try {
    Money.of(env.PLAN_PRICE_MINOR, env.PLAN_CURRENCY);
  } catch (error) {
    if (!(error instanceof InvalidMoneyError)) throw error;
    throw new Error(`Invalid environment configuration:\n - PLAN_PRICE_MINOR / PLAN_CURRENCY: ${error.message}`);
  }

  // The mock's webhook "signature" is a fixed, public string. In production anyone could forge a "payment succeeded"
  // webhook and activate accounts for free. The mock is for development and tests only: refuse to run it in production.
  if (env.NODE_ENV === Environment.Production && env.PAYMENT_PROVIDER === PaymentProviderName.Mock) {
    throw new Error('Invalid environment configuration:\n - PAYMENT_PROVIDER=mock is not allowed when NODE_ENV=production');
  }

  // The secret in .env.example is public (it is in the repository). Anyone who knows it can forge tokens, so a
  // production deployment that copied the example file unchanged must fail loudly instead of running insecurely.
  if (env.NODE_ENV === Environment.Production && env.JWT_SECRET.startsWith(DEV_SECRET_PREFIX)) {
    throw new Error('Invalid environment configuration:\n - JWT_SECRET is the public development example; set a real secret');
  }
  return env;
}
