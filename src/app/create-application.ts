import type { Client } from 'discord.js';

import { createDiscordClient } from '../bot/client.js';
import { loadCommands } from '../bot/command-loader.js';
import { commandDefinitions } from '../bot/commands.js';
import { EventRegistry } from '../bot/event-registry.js';
import { registerEvents } from '../bot/event-loader.js';
import { createEventDefinitions } from '../bot/events.js';
import type { CommandContext } from '../bot/types.js';
import { parseRuntimeEnvironment, type RuntimeEnvironment } from '../config/env.js';
import { createDatabaseClient } from '../database/client.js';
import { ConsoleLogger, type Logger } from '../logging/logger.js';
import { ClubRepository } from '../repositories/club-repository.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import { GuildConfigurationService } from '../services/guild-configuration-service.js';
import { OfferAcceptanceService } from '../services/offer-acceptance-service.js';
import { Application, type DatabaseLifecycle } from './application.js';

export interface ApplicationBundle {
  application: Application;
  logger: Logger;
}

export interface ApplicationFactories {
  createDiscordClient(): Client;
  createLogger(environment: RuntimeEnvironment): Logger;
}

const defaultFactories: ApplicationFactories = {
  createDiscordClient,
  createLogger: (environment) => new ConsoleLogger(environment.LOG_LEVEL),
};

export function createApplication(
  values: NodeJS.ProcessEnv = process.env,
  factories: ApplicationFactories = defaultFactories,
): ApplicationBundle {
  const environment = parseRuntimeEnvironment(values);
  const logger = factories.createLogger(environment);
  const prisma = createDatabaseClient(environment.DATABASE_URL);
  const discord = factories.createDiscordClient();
  const guilds = new GuildRepository(prisma);
  const clubs = new ClubRepository(prisma);
  const guildConfigurationService = new GuildConfigurationService(guilds, clubs);
  const offerAcceptanceService = new OfferAcceptanceService(prisma);
  const commands = loadCommands(commandDefinitions);
  const context: CommandContext = {
    logger,
    guildConfigurationService,
    offerAcceptanceService,
  };
  const events = new EventRegistry(createEventDefinitions(commands, context, logger));
  const database: DatabaseLifecycle = {
    connect: () => prisma.$connect(),
    disconnect: () => prisma.$disconnect(),
  };
  const application = new Application({
    discordToken: environment.DISCORD_TOKEN,
    database,
    discord,
    logger,
    register: () => {
      registerEvents(discord, events, logger);
      logger.debug('application definitions registered', {
        commandCount: commands.size,
        eventCount: events.size,
      });
    },
  });
  return { application, logger };
}
