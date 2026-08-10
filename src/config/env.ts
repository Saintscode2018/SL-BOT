import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

import { ConfigurationError } from '../domain/errors.js';
import { discordSnowflakeSchema } from '../domain/validation.js';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1).default('file:./dev.db'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  DISCORD_TOKEN: z.string().min(1).optional(),
  DISCORD_APPLICATION_ID: discordSnowflakeSchema.optional(),
  DISCORD_DEVELOPMENT_GUILD_ID: discordSnowflakeSchema.optional(),
});

const runtimeEnvironmentSchema = environmentSchema.extend({
  DISCORD_TOKEN: z.string().min(1),
});

const commandDeploymentEnvironmentSchema = environmentSchema.extend({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_APPLICATION_ID: discordSnowflakeSchema,
  DISCORD_DEVELOPMENT_GUILD_ID: discordSnowflakeSchema,
});

export type AppEnvironment = z.infer<typeof environmentSchema>;
export type RuntimeEnvironment = z.infer<typeof runtimeEnvironmentSchema>;
export type CommandDeploymentEnvironment = z.infer<typeof commandDeploymentEnvironmentSchema>;

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

export function parseCommandDeploymentEnvironment(
  values: NodeJS.ProcessEnv,
): CommandDeploymentEnvironment {
  const result = commandDeploymentEnvironmentSchema.safeParse(values);
  if (!result.success) throw configurationError(result.error);
  return result.data;
}

function loadDotenvInto(values: NodeJS.ProcessEnv, path?: string): void {
  const populatedValues: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) populatedValues[key] = value;
  }
  loadDotenv({
    processEnv: populatedValues,
    override: false,
    quiet: true,
    ...(path === undefined ? {} : { path }),
  });
  Object.assign(values, populatedValues);
}

export function loadEnvironment(
  values: NodeJS.ProcessEnv = process.env,
  path?: string,
): AppEnvironment {
  loadDotenvInto(values, path);
  return parseEnvironment(values);
}

export function loadRuntimeEnvironment(
  values: NodeJS.ProcessEnv = process.env,
  path?: string,
): RuntimeEnvironment {
  loadDotenvInto(values, path);
  return parseRuntimeEnvironment(values);
}
