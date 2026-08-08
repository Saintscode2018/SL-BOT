import type {
  ActionRowBuilder,
  ButtonBuilder,
  EmbedBuilder,
  MessageFlags,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { PrismaClient } from '@prisma/client';

import type { Logger } from '../logging/logger.js';
import type { ClubManagementService } from '../services/club-management-service.js';
import type { BotPermissionService } from '../services/bot-permission-service.js';
import type { CommandChannelPolicyService } from '../services/command-channel-policy-service.js';
import type { GuildConfigurationService } from '../services/guild-configuration-service.js';
import type { GuildSetupService } from '../services/guild-setup-service.js';
import type { LimitManagementService } from '../services/limit-management-service.js';
import type { OfferAcceptanceService } from '../services/offer-acceptance-service.js';
import type { OfferDeliveryService } from '../services/offer-delivery-service.js';
import type { RosterManagementService } from '../services/roster-management-service.js';
import type { RosterAdministrationService } from '../services/roster-administration-service.js';
import type { StaffManagementService } from '../services/staff-management-service.js';
import type { SetupAuditService } from '../services/setup-audit-service.js';
import type { TeamHealthService } from '../services/team-health-service.js';
import type { FranchiseOwnerListService } from '../services/franchise-owner-list-service.js';
import type { DataImportService, GuildMemberSnapshot } from '../services/data-import-service.js';
import type { OfferButtonHandler } from './offer-button-handler.js';
import type { RosterDepartureCommandHandler } from './departure-command-handler.js';
import type { RosterPromotionDemotionCommandHandler } from './promotion-demotion-command-handler.js';
import type { TeamDisbandmentCommandHandler } from './team-disbandment-command-handler.js';
import type { TeamSwapCommandHandler } from './team-swap-command-handler.js';
import type { GuildEmoji } from './emoji-helper.js';

export interface SafeInteractionResponse {
  content?: string;
  embeds?: readonly EmbedBuilder[];
  components?: ActionRowBuilder<ButtonBuilder>[];
  flags?: MessageFlags.Ephemeral;
}

export interface DeferredInteractionResponse {
  flags?: MessageFlags.Ephemeral;
}

export interface GuildRoleMetadata {
  id: string;
  name: string;
  color: number;
}

export interface EditedInteractionResponse {
  content?: string;
  embeds?: readonly EmbedBuilder[];
  components?: ActionRowBuilder<ButtonBuilder>[];
}

export interface ButtonInteractionAdapter {
  readonly customId: string;
  readonly userId: string;
  readonly userDisplayName?: string | undefined;
  readonly guildId?: string | undefined;
  readonly guildName?: string | undefined;
  readonly guildIconUrl?: string | undefined;
  readonly guildOwnerId?: string | undefined;
  readonly channelId?: string | undefined;
  readonly memberRoleIds?: readonly string[] | undefined;
  readonly hasAdministratorPermission?: boolean | undefined;
  readonly replied: boolean;
  readonly deferred: boolean;
  getGuildRoleMetadata?(roleId: string): GuildRoleMetadata | null;
  getGuildMemberDisplayName?(userId: string): string | null;
  resolveGuildRoleMetadata?(roleId: string): Promise<GuildRoleMetadata | null>;
  resolveGuildMemberDisplayName?(userId: string): Promise<string | null>;
  deferUpdate(): Promise<void>;
  reply(response: SafeInteractionResponse): Promise<void>;
  editReply(response: EditedInteractionResponse): Promise<void>;
  followUp(response: SafeInteractionResponse): Promise<void>;
}

export interface CommandInteraction {
  readonly commandName: string;
  readonly replied: boolean;
  readonly deferred: boolean;
  readonly guildId?: string | undefined;
  readonly guildName?: string | undefined;
  readonly guildIconUrl?: string | undefined;
  readonly guildOwnerId?: string | undefined;
  readonly userId?: string | undefined;
  readonly userDisplayName?: string | undefined;
  readonly channelId?: string | undefined;
  readonly memberRoleIds?: readonly string[] | undefined;
  readonly hasAdministratorPermission?: boolean | undefined;
  readonly options?: CommandInteractionOptions | undefined;
  getGuildEmojis?(): readonly GuildEmoji[];
  getGuildRoleMetadata?(roleId: string): GuildRoleMetadata | null;
  getGuildMemberDisplayName?(userId: string): string | null;
  resolveGuildRoleMetadata?(roleId: string): Promise<GuildRoleMetadata | null>;
  resolveGuildMemberDisplayName?(userId: string): Promise<string | null>;
  fetchGuildMembers?(): Promise<readonly GuildMemberSnapshot[]>;
  executeDebugReset?(
    database: PrismaClient,
    setupAuditService?: Pick<SetupAuditService, 'publish'>,
  ): Promise<void>;
  reply(response: SafeInteractionResponse): Promise<void>;

  deferReply(response?: DeferredInteractionResponse): Promise<void>;
  editReply(response: EditedInteractionResponse): Promise<void>;
  followUp(response: SafeInteractionResponse): Promise<void>;
  deleteReply(): Promise<void>;
}

export interface CommandInteractionOptions {
  getSubcommand(): string | null;
  getSubcommandGroup?(): string | null;
  getString(name: string): string | null;
  getInteger(name: string): number | null;
  getUser(name: string): { id: string; bot: boolean; displayName?: string } | null;
  getRole(name: string): { id: string } | null;
  getChannel(name: string): { id: string; type: number } | null;
}

export interface CommandAutocompleteInteraction {
  readonly commandName: string;
  readonly guildId: string | null;
  readonly focusedName: string;
  readonly focusedValue: string;
  getGuildRoles?(): readonly GuildRoleMetadata[];
  respond(choices: Array<{ name: string; value: string }>): Promise<void>;
}

export interface CommandContext {
  logger: Logger;
  database: PrismaClient;
  databaseHealth: { check(): Promise<boolean> };
  guildConfigurationService: Pick<GuildConfigurationService, 'load'>;
  offerAcceptanceService: Pick<OfferAcceptanceService, 'acceptOffer'>;
  guildSetupService: Pick<
    GuildSetupService,
    'setup' | 'setupGuildOnly' | 'setupChannels' | 'setupRoles' | 'getView'
  >;
  botPermissionService?: Pick<
    BotPermissionService,
    'addStandard' | 'removeStandard' | 'addAdmin' | 'list'
  >;
  clubManagementService: Pick<
    ClubManagementService,
    'create' | 'edit' | 'deactivate' | 'listActive' | 'autocomplete'
  >;
  staffManagementService: Pick<
    StaffManagementService,
    'appoint' | 'remove' | 'list' | 'getCallerActiveStaffClub'
  >;

  rosterManagementService: Pick<RosterManagementService, 'add' | 'remove' | 'list'>;
  rosterAdministrationService?: Pick<RosterAdministrationService, 'add' | 'remove'>;
  limitManagementService: Pick<
    LimitManagementService,
    'setDefaultLimit' | 'setTeamLimit' | 'resetTeamLimit' | 'viewLimit'
  >;
  commandChannelPolicyService: Pick<CommandChannelPolicyService, 'validateChannelPolicy'>;
  offerDeliveryService: Pick<OfferDeliveryService, 'createAndDeliver'>;
  offerButtonHandler: Pick<OfferButtonHandler, 'handle'>;
  departureCommandHandler?: Pick<
    RosterDepartureCommandHandler,
    'beginDemand' | 'beginRelease' | 'canHandle' | 'handleButton'
  >;
  promotionDemotionCommandHandler?: Pick<
    RosterPromotionDemotionCommandHandler,
    'beginPromote' | 'beginDemote' | 'canHandle' | 'handleButton'
  >;
  teamDisbandmentCommandHandler?: Pick<
    TeamDisbandmentCommandHandler,
    'begin' | 'canHandle' | 'handleButton'
  >;
  teamSwapCommandHandler?: Pick<TeamSwapCommandHandler, 'begin' | 'canHandle' | 'handleButton'>;
  setupAuditService: Pick<SetupAuditService, 'publish'>;
  teamHealthService?: Pick<TeamHealthService, 'getOverview' | 'getDetail'>;
  franchiseOwnerListService?: Pick<FranchiseOwnerListService, 'getList'>;
  dataImportService?: Pick<DataImportService, 'importGuild'>;
}

export interface CommandDefinition {
  data: {
    readonly name: string;
    toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody;
  };
  execute(interaction: CommandInteraction, context: CommandContext): Promise<void>;
  autocomplete?(
    interaction: CommandAutocompleteInteraction,
    context: CommandContext,
  ): Promise<void>;
}
