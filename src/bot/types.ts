import type {
  EmbedBuilder,
  MessageFlags,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { PrismaClient } from '@prisma/client';

import type { Logger } from '../logging/logger.js';
import type { ClubManagementService } from '../services/club-management-service.js';
import type { CommandChannelPolicyService } from '../services/command-channel-policy-service.js';
import type { GuildConfigurationService } from '../services/guild-configuration-service.js';
import type { GuildSetupService } from '../services/guild-setup-service.js';
import type { LimitManagementService } from '../services/limit-management-service.js';
import type { OfferAcceptanceService } from '../services/offer-acceptance-service.js';
import type { OfferDeliveryService } from '../services/offer-delivery-service.js';
import type { RosterManagementService } from '../services/roster-management-service.js';
import type { StaffManagementService } from '../services/staff-management-service.js';
import type { SetupAuditService } from '../services/setup-audit-service.js';
import type { OfferButtonHandler } from './offer-button-handler.js';
import type { GuildEmoji } from './emoji-helper.js';

export interface SafeInteractionResponse {
  content?: string;
  embeds?: readonly EmbedBuilder[];
  flags?: MessageFlags.Ephemeral;
}

export interface DeferredInteractionResponse {
  flags?: MessageFlags.Ephemeral;
}

export interface EditedInteractionResponse {
  content?: string;
  embeds?: readonly EmbedBuilder[];
}

export interface CommandInteraction {
  readonly commandName: string;
  readonly replied: boolean;
  readonly deferred: boolean;
  readonly guildId?: string | undefined;
  readonly guildName?: string | undefined;
  readonly guildOwnerId?: string | undefined;
  readonly userId?: string | undefined;
  readonly channelId?: string | undefined;
  readonly memberRoleIds?: readonly string[] | undefined;
  readonly hasAdministratorPermission?: boolean | undefined;
  readonly options?: CommandInteractionOptions | undefined;
  getGuildEmojis?(): readonly GuildEmoji[];
  executeDebugReset?(database: PrismaClient): Promise<void>;
  reply(response: SafeInteractionResponse): Promise<void>;

  deferReply(response?: DeferredInteractionResponse): Promise<void>;
  editReply(response: EditedInteractionResponse): Promise<void>;
  followUp(response: SafeInteractionResponse): Promise<void>;
  deleteReply(): Promise<void>;
}

export interface CommandInteractionOptions {
  getSubcommand(): string | null;
  getString(name: string): string | null;
  getInteger(name: string): number | null;
  getUser(name: string): { id: string; bot: boolean } | null;
  getRole(name: string): { id: string } | null;
  getChannel(name: string): { id: string; type: number } | null;
}

export interface CommandAutocompleteInteraction {
  readonly commandName: string;
  readonly guildId: string | null;
  readonly focusedName: string;
  readonly focusedValue: string;
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
  clubManagementService: Pick<
    ClubManagementService,
    'create' | 'edit' | 'deactivate' | 'listActive' | 'autocomplete'
  >;
  staffManagementService: Pick<
    StaffManagementService,
    'appoint' | 'remove' | 'list' | 'getCallerActiveStaffClub'
  >;

  rosterManagementService: Pick<RosterManagementService, 'add' | 'remove' | 'list'>;
  limitManagementService: Pick<
    LimitManagementService,
    'setDefaultLimit' | 'setTeamLimit' | 'resetTeamLimit' | 'viewLimit'
  >;
  commandChannelPolicyService: Pick<CommandChannelPolicyService, 'validateChannelPolicy'>;
  offerDeliveryService: Pick<OfferDeliveryService, 'createAndDeliver'>;
  offerButtonHandler: Pick<OfferButtonHandler, 'handle'>;
  setupAuditService: Pick<SetupAuditService, 'publish'>;
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
