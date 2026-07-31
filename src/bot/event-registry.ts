import type { Client, ClientEvents } from 'discord.js';

import { ConflictError } from '../domain/errors.js';
import type { Logger } from '../logging/logger.js';

export interface EventDefinition<K extends keyof ClientEvents> {
  name: K;
  once?: boolean;
  execute(...args: ClientEvents[K]): Promise<void> | void;
}

export interface RegisterableEvent {
  readonly name: keyof ClientEvents;
  register(client: Client, logger: Logger): void;
}

export function defineEvent<K extends keyof ClientEvents>(
  definition: EventDefinition<K>,
): RegisterableEvent {
  return {
    name: definition.name,
    register(client, logger) {
      const listener = (...args: ClientEvents[K]): void => {
        void Promise.resolve(definition.execute(...args)).catch((error: unknown) => {
          logger.error('event execution failed', error, { eventName: definition.name });
        });
      };
      if (definition.once === true) {
        client.once(definition.name, listener);
      } else {
        client.on(definition.name, listener);
      }
    },
  };
}

export class EventRegistry {
  private readonly events = new Map<keyof ClientEvents, RegisterableEvent>();

  public constructor(definitions: readonly RegisterableEvent[] = []) {
    for (const definition of definitions) {
      this.add(definition);
    }
  }

  public add(definition: RegisterableEvent): void {
    if (this.events.has(definition.name)) {
      throw new ConflictError(`event ${definition.name} is already registered`);
    }
    this.events.set(definition.name, definition);
  }

  public registerAll(client: Client, logger: Logger): void {
    for (const event of this.events.values()) {
      event.register(client, logger);
    }
  }

  public get size(): number {
    return this.events.size;
  }
}
