import type { SlashCommandBuilder } from 'discord.js';

import type { Logger } from '../logging/logger.js';
import type { GuildConfigurationService } from '../services/guild-configuration-service.js';
import type { OfferAcceptanceService } from '../services/offer-acceptance-service.js';

export interface SafeInteractionResponse {
  content: string;
  ephemeral: true;
}

export interface CommandInteraction {
  readonly commandName: string;
  readonly replied: boolean;
  readonly deferred: boolean;
  reply(response: SafeInteractionResponse): Promise<void>;
  followUp(response: SafeInteractionResponse): Promise<void>;
}

export interface CommandContext {
  logger: Logger;
  guildConfigurationService: Pick<GuildConfigurationService, 'load'>;
  offerAcceptanceService: Pick<OfferAcceptanceService, 'acceptOffer'>;
}

export interface CommandDefinition {
  data: SlashCommandBuilder;
  execute(interaction: CommandInteraction, context: CommandContext): Promise<void>;
}
