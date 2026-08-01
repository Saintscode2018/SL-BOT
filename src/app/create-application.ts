import type { Client } from 'discord.js';

import { createDiscordClient } from '../bot/client.js';
import { loadCommands } from '../bot/command-loader.js';
import { commandDefinitions } from '../bot/commands.js';
import { EventRegistry } from '../bot/event-registry.js';
import { registerEvents } from '../bot/event-loader.js';
import { createEventDefinitions } from '../bot/events.js';
import { OfferButtonHandler } from '../bot/offer-button-handler.js';
import { DiscordOfferMessageAdapter } from '../bot/offer-message-adapter.js';
import type { CommandContext } from '../bot/types.js';
import {
  loadRuntimeEnvironment,
  parseRuntimeEnvironment,
  type RuntimeEnvironment,
} from '../config/env.js';
import { createDatabaseClient } from '../database/client.js';
import { ConsoleLogger, type Logger } from '../logging/logger.js';
import { ClubRepository } from '../repositories/club-repository.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import { ClubManagementService } from '../services/club-management-service.js';
import { CommandChannelPolicyService } from '../services/command-channel-policy-service.js';
import { DatabaseHealthService } from '../services/database-health-service.js';
import { GuildConfigurationService } from '../services/guild-configuration-service.js';
import { GuildSetupService } from '../services/guild-setup-service.js';
import { LimitManagementService } from '../services/limit-management-service.js';
import { OfferAcceptanceService } from '../services/offer-acceptance-service.js';
import { OfferCreationService } from '../services/offer-creation-service.js';
import { OfferDeclineService } from '../services/offer-decline-service.js';
import { OfferDeliveryService } from '../services/offer-delivery-service.js';
import { OfferResponseService } from '../services/offer-response-service.js';
import { RosterManagementService } from '../services/roster-management-service.js';
import { StaffManagementService } from '../services/staff-management-service.js';
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
  values?: NodeJS.ProcessEnv,
  factories: ApplicationFactories = defaultFactories,
): ApplicationBundle {
  const environment =
    values === undefined ? loadRuntimeEnvironment() : parseRuntimeEnvironment(values);
  const logger = factories.createLogger(environment);
  const prisma = createDatabaseClient(environment.DATABASE_URL);
  const discord = factories.createDiscordClient();
  const guilds = new GuildRepository(prisma);
  const clubs = new ClubRepository(prisma);
  const guildConfigurationService = new GuildConfigurationService(guilds, clubs);
  const offerAcceptanceService = new OfferAcceptanceService(prisma);
  const offerDeclineService = new OfferDeclineService(prisma);
  const offerMessages = new DiscordOfferMessageAdapter(discord);
  const offerDeliveryService = new OfferDeliveryService(
    prisma,
    offerMessages,
    logger,
    new OfferCreationService(prisma),
  );
  const offerButtonHandler = new OfferButtonHandler(
    new OfferResponseService(prisma, offerAcceptanceService, offerDeclineService),
    offerDeliveryService,
    offerMessages,
    logger,
  );
  const commands = loadCommands(commandDefinitions);
  const context: CommandContext = {
    logger,
    database: prisma,
    databaseHealth: new DatabaseHealthService(prisma),
    guildConfigurationService,
    offerAcceptanceService,
    guildSetupService: new GuildSetupService(prisma),
    clubManagementService: new ClubManagementService(prisma),
    staffManagementService: new StaffManagementService(prisma),
    rosterManagementService: new RosterManagementService(prisma),
    limitManagementService: new LimitManagementService(prisma),
    commandChannelPolicyService: new CommandChannelPolicyService(prisma),
    offerDeliveryService,
    offerButtonHandler,
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
