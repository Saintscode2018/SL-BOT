import { Events } from 'discord.js';

import type { Logger } from '../logging/logger.js';
import type { CommandRegistry } from './command-registry.js';
import { defineEvent, type RegisterableEvent } from './event-registry.js';
import { createInteractionCreateHandler } from './interaction-handler.js';
import type { CommandContext } from './types.js';

export function createEventDefinitions(
  commands: CommandRegistry,
  context: CommandContext,
  logger: Logger,
): RegisterableEvent[] {
  return [
    defineEvent({
      name: Events.InteractionCreate,
      execute: createInteractionCreateHandler(commands, context, logger),
    }),
  ];
}
