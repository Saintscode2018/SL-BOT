import type { Client } from 'discord.js';

import type { Logger } from '../logging/logger.js';
import type { EventRegistry } from './event-registry.js';

export function registerEvents(client: Client, registry: EventRegistry, logger: Logger): void {
  registry.registerAll(client, logger);
}
