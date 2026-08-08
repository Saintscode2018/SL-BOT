import type { Client } from 'discord.js';

import { createDiscordClient } from '../bot/client.js';
import { RosterDepartureCommandHandler } from '../bot/departure-command-handler.js';
import { RosterPromotionDemotionCommandHandler } from '../bot/promotion-demotion-command-handler.js';
import { TeamDisbandmentCommandHandler } from '../bot/team-disbandment-command-handler.js';
import { loadCommands } from '../bot/command-loader.js';
import { commandDefinitions } from '../bot/commands.js';
import { EventRegistry } from '../bot/event-registry.js';
import { registerEvents } from '../bot/event-loader.js';
import { createEventDefinitions } from '../bot/events.js';
import { OfferButtonHandler } from '../bot/offer-button-handler.js';
import { DiscordOfferMessageAdapter } from '../bot/offer-message-adapter.js';
import { DiscordMemberRoleAdapter } from '../bot/discord-member-role-adapter.js';
import { DiscordSetupAuditMessageAdapter } from '../bot/setup-audit-message-adapter.js';
import { DiscordAuditAnnouncementAdapter } from '../bot/audit-announcement-adapter.js';
import { DiscordAuditAnnouncementPresentationProvider } from '../bot/audit-announcement-presentation.js';
import { DiscordTransferAnnouncementAdapter } from '../bot/transfer-announcement-adapter.js';
import { DiscordTransferAnnouncementPresentationProvider } from '../bot/transfer-announcement-presentation.js';
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
import { AuditAnnouncementService } from '../services/audit-announcement-service.js';
import { ClubManagementService } from '../services/club-management-service.js';
import { CommandChannelPolicyService } from '../services/command-channel-policy-service.js';
import { ConfirmationRegistry } from '../services/confirmation-registry.js';
import { DatabaseHealthService } from '../services/database-health-service.js';
import { GuildConfigurationService } from '../services/guild-configuration-service.js';
import { GuildSetupService } from '../services/guild-setup-service.js';
import { demandRateLimitMs, GuildUserRateLimiter } from '../services/guild-user-rate-limiter.js';
import { LimitManagementService } from '../services/limit-management-service.js';
import { MemberRoleSynchronizationService } from '../services/member-role-synchronization-service.js';
import { OfferAcceptanceService } from '../services/offer-acceptance-service.js';
import { OfferCreationService } from '../services/offer-creation-service.js';
import { OfferDeclineService } from '../services/offer-decline-service.js';
import { OfferDeliveryService } from '../services/offer-delivery-service.js';
import { OfferResponseService } from '../services/offer-response-service.js';
import { RosterManagementService } from '../services/roster-management-service.js';
import { RosterAdministrationService } from '../services/roster-administration-service.js';
import { RosterDepartureService } from '../services/roster-departure-service.js';
import { RosterPromotionDemotionService } from '../services/roster-promotion-demotion-service.js';
import { RoleSynchronizedMutationService } from '../services/role-synchronized-mutation-service.js';
import { RosterMutationService } from '../services/roster-mutation-service.js';
import { StaffManagementService } from '../services/staff-management-service.js';
import { SetupAuditService } from '../services/setup-audit-service.js';
import { TransferAnnouncementService } from '../services/transfer-announcement-service.js';
import { TeamHealthService } from '../services/team-health-service.js';
import { TeamDisbandmentService } from '../services/team-disbandment-service.js';
import { FranchiseOwnerListService } from '../services/franchise-owner-list-service.js';
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
  const memberRoles = new MemberRoleSynchronizationService(
    new DiscordMemberRoleAdapter(discord),
    logger,
  );
  const transferAnnouncements = new TransferAnnouncementService(
    new DiscordTransferAnnouncementAdapter(discord),
    logger,
    new DiscordTransferAnnouncementPresentationProvider(discord),
  );
  const auditAnnouncements = new AuditAnnouncementService(
    new DiscordAuditAnnouncementAdapter(discord),
    logger,
    new DiscordAuditAnnouncementPresentationProvider(discord),
  );
  const synchronizedMutations = new RoleSynchronizedMutationService(
    memberRoles,
    transferAnnouncements,
    auditAnnouncements,
    logger,
  );
  const rosterMutations = new RosterMutationService(prisma, synchronizedMutations);
  const commandChannelPolicy = new CommandChannelPolicyService(prisma);
  const confirmations = new ConfirmationRegistry(logger);
  const departureCommandHandler = new RosterDepartureCommandHandler(
    commandChannelPolicy,
    new RosterDepartureService(prisma, rosterMutations),
    confirmations,
    new GuildUserRateLimiter(demandRateLimitMs),
  );
  const promotionDemotionCommandHandler = new RosterPromotionDemotionCommandHandler(
    commandChannelPolicy,
    new RosterPromotionDemotionService(prisma, rosterMutations),
    confirmations,
  );
  const teamDisbandmentCommandHandler = new TeamDisbandmentCommandHandler(
    commandChannelPolicy,
    new TeamDisbandmentService(prisma, synchronizedMutations),
    confirmations,
  );
  const offerAcceptanceService = new OfferAcceptanceService(
    prisma,
    undefined,
    synchronizedMutations,
  );
  const offerDeclineService = new OfferDeclineService(prisma, auditAnnouncements);
  const offerMessages = new DiscordOfferMessageAdapter(discord);
  const setupAuditService = new SetupAuditService(
    new DiscordSetupAuditMessageAdapter(discord),
    logger,
  );
  const offerDeliveryService = new OfferDeliveryService(
    prisma,
    offerMessages,
    logger,
    new OfferCreationService(prisma),
    auditAnnouncements,
  );
  const offerButtonHandler = new OfferButtonHandler(
    new OfferResponseService(
      prisma,
      offerAcceptanceService,
      offerDeclineService,
      auditAnnouncements,
    ),
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
    staffManagementService: new StaffManagementService(prisma, rosterMutations),
    rosterManagementService: new RosterManagementService(prisma),
    rosterAdministrationService: new RosterAdministrationService(prisma, synchronizedMutations),
    limitManagementService: new LimitManagementService(prisma),
    commandChannelPolicyService: commandChannelPolicy,
    offerDeliveryService,
    offerButtonHandler,
    departureCommandHandler,
    promotionDemotionCommandHandler,
    teamDisbandmentCommandHandler,
    setupAuditService,
    teamHealthService: new TeamHealthService(prisma),
    franchiseOwnerListService: new FranchiseOwnerListService(prisma),
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
