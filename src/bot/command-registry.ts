import type { SlashCommandBuilder } from 'discord.js';

import { ConflictError } from '../domain/errors.js';
import type { CommandDefinition } from './types.js';

export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>();

  public constructor(definitions: readonly CommandDefinition[] = []) {
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  public register(definition: CommandDefinition): void {
    const name = definition.data.name;
    if (this.commands.has(name)) {
      throw new ConflictError(`command ${name} is already registered`);
    }
    this.commands.set(name, definition);
  }

  public resolve(name: string): CommandDefinition | null {
    return this.commands.get(name) ?? null;
  }

  public toJSON(): Array<ReturnType<SlashCommandBuilder['toJSON']>> {
    return [...this.commands.values()].map(({ data }) => data.toJSON());
  }

  public get size(): number {
    return this.commands.size;
  }
}
