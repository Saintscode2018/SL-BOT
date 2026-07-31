import type { MessageFlags, RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';

import type { Logger } from '../logging/logger.js';
import type { ClubManagementService } from '../services/club-management-service.js';
import type { GuildConfigurationService } from '../services/guild-configuration-service.js';
import type { GuildSetupService } from '../services/guild-setup-service.js';
import type { OfferAcceptanceService } from '../services/offer-acceptance-service.js';
import type { OfferDeliveryService } from '../services/offer-delivery-service.js';
import type { RosterManagementService } from '../services/roster-management-service.js';
import type { StaffManagementService } from '../services/staff-management-service.js';
import type { OfferButtonHandler } from './offer-button-handler.js';

export interface SafeInteractionResponse {
  content: string;
  flags: MessageFlags.Ephemeral;
}

export interface DeferredInteractionResponse {
  flags: MessageFlags.Ephemeral;
}

export interface EditedInteractionResponse {
  content: string;
}

export interface CommandInteraction {
  readonly commandName: string;
  readonly replied: boolean;
  readonly deferred: boolean;
  readonly guildId?: string | undefined;
  readonly guildName?: string | undefined;
  readonly guildOwnerId?: string | undefined;
  readonly userId?: string | undefined;
  readonly memberRoleIds?: readonly string[] | undefined;
  readonly hasAdministratorPermission?: boolean | undefined;
  readonly options?: CommandInteractionOptions | undefined;
  reply(response: SafeInteractionResponse): Promise<void>;
  deferReply(response: DeferredInteractionResponse): Promise<void>;
  editReply(response: EditedInteractionResponse): Promise<void>;
  followUp(response: SafeInteractionResponse): Promise<void>;
}

export interface CommandInteractionOptions {
  getSubcommand(): string;
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
  databaseHealth: { check(): Promise<boolean> };
  guildConfigurationService: Pick<GuildConfigurationService, 'load'>;
  offerAcceptanceService: Pick<OfferAcceptanceService, 'acceptOffer'>;
  guildSetupService: Pick<GuildSetupService, 'setup'>;
  clubManagementService: Pick<
    ClubManagementService,
    'create' | 'deactivate' | 'listActive' | 'autocomplete'
  >;
  staffManagementService: Pick<StaffManagementService, 'appoint' | 'remove' | 'list'>;
  rosterManagementService: Pick<RosterManagementService, 'add' | 'remove' | 'list'>;
  offerDeliveryService: Pick<OfferDeliveryService, 'createAndDeliver'>;
  offerButtonHandler: Pick<OfferButtonHandler, 'handle'>;
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
