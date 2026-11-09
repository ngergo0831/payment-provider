import { plainToInstance, Type } from 'class-transformer';
import { IsEnum, IsInt, Max, Min, validateSync } from 'class-validator';

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
  return env;
}
