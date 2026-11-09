import { plainToInstance, Type } from 'class-transformer';
import { IsEnum, IsInt, IsUrl, Matches, Max, Min, MinLength, validateSync } from 'class-validator';

/** Every example secret in this repository starts with this, so production can refuse them. */
const DEV_SECRET_PREFIX = 'dev-only';

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

  // The secret in .env.example is public (it is in the repository). Anyone who knows it can forge tokens, so a
  // production deployment that copied the example file unchanged must fail loudly instead of running insecurely.
  if (env.NODE_ENV === Environment.Production && env.JWT_SECRET.startsWith(DEV_SECRET_PREFIX)) {
    throw new Error('Invalid environment configuration:\n - JWT_SECRET is the public development example; set a real secret');
  }
  return env;
}
