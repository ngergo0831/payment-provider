import { Environment, validateEnv } from './env.validation';

/** The typed, structured view of configuration the rest of the app depends on. */
export interface AppConfig {
  nodeEnv: Environment;
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
}

/**
 * Validates the environment, then maps flat variables to the structured AppConfig.
 * Runs once at startup (ConfigModule `load`): an invalid environment throws here and the process exits.
 */
export const configuration = (): AppConfig => {
  const env = validateEnv(process.env);
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    database: { url: env.DATABASE_URL },
    jwt: { secret: env.JWT_SECRET, expiresIn: env.JWT_EXPIRES_IN },
  };
};
