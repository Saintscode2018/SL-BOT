import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

import { ConfigurationError } from '../domain/errors.js';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1).default('file:./dev.db'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  DISCORD_TOKEN: z.string().min(1).optional(),
});

const runtimeEnvironmentSchema = environmentSchema.extend({
  DISCORD_TOKEN: z.string().min(1),
});

export type AppEnvironment = z.infer<typeof environmentSchema>;
export type RuntimeEnvironment = z.infer<typeof runtimeEnvironmentSchema>;

function configurationError(error: z.ZodError): ConfigurationError {
  return new ConfigurationError(`invalid environment configuration: ${z.prettifyError(error)}`, {
    cause: error,
  });
}

export function parseEnvironment(values: NodeJS.ProcessEnv): AppEnvironment {
  const result = environmentSchema.safeParse(values);
  if (!result.success) {
    throw configurationError(result.error);
  }
  return result.data;
}

export function parseRuntimeEnvironment(values: NodeJS.ProcessEnv): RuntimeEnvironment {
  const result = runtimeEnvironmentSchema.safeParse(values);
  if (!result.success) {
    throw configurationError(result.error);
  }
  return result.data;
}

export function loadEnvironment(): AppEnvironment {
  loadDotenv();
  return parseEnvironment(process.env);
}

export function loadRuntimeEnvironment(): RuntimeEnvironment {
  loadDotenv();
  return parseRuntimeEnvironment(process.env);
}
