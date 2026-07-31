import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

import { ConfigurationError } from '../domain/errors.js';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1).default('file:./dev.db'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  DISCORD_TOKEN: z.string().min(1).optional(),
});

export type AppEnvironment = z.infer<typeof environmentSchema>;

export function parseEnvironment(values: NodeJS.ProcessEnv): AppEnvironment {
  const result = environmentSchema.safeParse(values);
  if (!result.success) {
    throw new ConfigurationError(
      `invalid environment configuration: ${z.prettifyError(result.error)}`,
      {
        cause: result.error,
      },
    );
  }
  return result.data;
}

export function loadEnvironment(): AppEnvironment {
  loadDotenv();
  return parseEnvironment(process.env);
}
