import { CommandRegistry } from './command-registry.js';
import type { CommandDefinition } from './types.js';

export function loadCommands(definitions: readonly CommandDefinition[]): CommandRegistry {
  return new CommandRegistry(definitions);
}
