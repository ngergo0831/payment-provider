import { plainToInstance, Transform } from 'class-transformer';
import { IsEnum, IsInt, IsUrl, Matches, Max, Min, MinLength, ValidateIf, validateSync } from 'class-validator';
import { LogFormat, LogLevelName } from '../common/logging/app-logger';
import { InvalidMoneyError, Money } from '../payments/domain/money';

const DEV_SECRET_PREFIX = 'dev-only';

/**
 * Environment variables are strings; this turns one into a number for validation. Number("") is 0, so an EMPTY
 * variable would pass as a real value (and 0 means "off" for the timers). It becomes NaN instead, and is rejected.
 */
const ToNumber = () => Transform(({ value }) => (value === '' ? NaN : Number(value)));

export enum PaymentProviderName {
  Mock = 'mock',
  Stripe = 'stripe',
}

export enum Environment {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

export class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment;

  @IsEnum(LogLevelName)
  LOG_LEVEL: LogLevelName = LogLevelName.Log;

  @IsEnum(LogFormat)
  LOG_FORMAT: LogFormat = LogFormat.Text;

  @ToNumber()
  @Max(65535)
  @Min(1)
  @IsInt()
  PORT: number = 3000;

  @IsUrl({ protocols: ['postgres', 'postgresql'], require_protocol: true, require_tld: false })
  DATABASE_URL: string;

  @MinLength(32)
  JWT_SECRET: string;

  @Matches(/^\d+[smhd]$/, { message: 'JWT_EXPIRES_IN must look like 30m, 24h or 7d' })
  JWT_EXPIRES_IN: string = '24h';

  @ToNumber()
  @Min(1)
  @IsInt()
  PLAN_PRICE_MINOR: number = 4900;

  @Matches(/^[A-Za-z]{3}$/, { message: 'PLAN_CURRENCY must be a 3-letter currency code such as USD' })
  PLAN_CURRENCY: string = 'USD';

  @IsEnum(PaymentProviderName)
  PAYMENT_PROVIDER: PaymentProviderName;

  @ValidateIf((env: EnvironmentVariables) => env.PAYMENT_PROVIDER === PaymentProviderName.Stripe)
  @Matches(/^sk_(test|live)_\S+$/, { message: 'STRIPE_SECRET_KEY must be a Stripe secret key (sk_test_... or sk_live_...)' })
  STRIPE_SECRET_KEY?: string;

  @ValidateIf((env: EnvironmentVariables) => env.PAYMENT_PROVIDER === PaymentProviderName.Stripe)
  @Matches(/^pk_(test|live)_\S+$/, { message: 'STRIPE_PUBLISHABLE_KEY must be a Stripe publishable key (pk_test_... or pk_live_...)' })
  STRIPE_PUBLISHABLE_KEY?: string;

  @ValidateIf((env: EnvironmentVariables) => env.PAYMENT_PROVIDER === PaymentProviderName.Stripe)
  @Matches(/^whsec_\S+$/, { message: 'STRIPE_WEBHOOK_SECRET must be a Stripe webhook signing secret (whsec_...)' })
  STRIPE_WEBHOOK_SECRET?: string;

  @ToNumber()
  @Min(0)
  @IsInt()
  OUTBOX_POLL_INTERVAL_MS: number = 1000;

  @ToNumber()
  @Min(0)
  @IsInt()
  RECONCILE_INTERVAL_MS: number = 60000;

  @ToNumber()
  @Min(1)
  @IsInt()
  RATE_LIMIT_PER_MINUTE: number = 20;
}

export function validateEnv(raw: Record<string, unknown>): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, raw, { exposeDefaultValues: true });
  const fieldProblems = validateSync(env, { stopAtFirstError: true }).flatMap((error) => Object.values(error.constraints ?? {}));
  const problems = fieldProblems.length > 0 ? fieldProblems : combinationProblems(env);

  if (problems.length > 0) {
    throw new Error(`Invalid environment configuration:\n - ${problems.join('\n - ')}`);
  }
  return env;
}

function combinationProblems(env: EnvironmentVariables): string[] {
  const problems: string[] = [];
  const isProduction = env.NODE_ENV === Environment.Production;

  try {
    Money.of(env.PLAN_PRICE_MINOR, env.PLAN_CURRENCY);
  } catch (error) {
    if (!(error instanceof InvalidMoneyError)) throw error;
    problems.push(`PLAN_PRICE_MINOR / PLAN_CURRENCY: ${error.message}`);
  }

  if (isProduction && env.PAYMENT_PROVIDER === PaymentProviderName.Mock) {
    problems.push('PAYMENT_PROVIDER=mock is not allowed when NODE_ENV=production');
  }

  if (isProduction && env.JWT_SECRET.startsWith(DEV_SECRET_PREFIX)) {
    problems.push('JWT_SECRET is the public development example; set a real secret');
  }
  return problems;
}
