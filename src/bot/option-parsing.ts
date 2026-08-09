import { ConfigurationError } from '../domain/errors.js';
import type { CommandInteractionOptions } from './types.js';

export function requireString(
  options: CommandInteractionOptions,
  name: string,
  errorMessage?: string,
): string {
  const value = options.getString(name);
  if (value === null) {
    throw new ConfigurationError(errorMessage ?? `${name} is required`);
  }
  return value;
}

export function requireInteger(
  options: CommandInteractionOptions,
  name: string,
  errorMessage?: string,
): number {
  const value = options.getInteger(name);
  if (value === null) {
    throw new ConfigurationError(errorMessage ?? `${name} is required`);
  }
  return value;
}

export function requireUser(
  options: CommandInteractionOptions,
  name: string,
  errorMessage?: string,
): { id: string; bot: boolean; displayName?: string } {
  const value = options.getUser(name);
  if (value === null) {
    throw new ConfigurationError(errorMessage ?? `${name} is required`);
  }
  return value;
}

export function requireRole(
  options: CommandInteractionOptions,
  name: string,
  errorMessage?: string,
): { id: string; guildId?: string } {
  const value = options.getRole(name);
  if (value === null) {
    throw new ConfigurationError(errorMessage ?? `${name} is required`);
  }
  return value;
}

export function requireChannel(
  options: CommandInteractionOptions,
  name: string,
  errorMessage?: string,
): { id: string; type: number } {
  const value = options.getChannel(name);
  if (value === null) {
    throw new ConfigurationError(errorMessage ?? `${name} is required`);
  }
  return value;
}
