import { Environment, validateEnv } from './env.validation';

/** The typed, structured view of configuration the rest of the app depends on. */
export interface AppConfig {
  nodeEnv: Environment;
  port: number;
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
  };
};
