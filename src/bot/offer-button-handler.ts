import type { Offer } from '@prisma/client';
import { MessageFlags } from 'discord.js';

import { OfferExpiredError } from '../domain/errors.js';
import type { Logger } from '../logging/logger.js';
import type {
  OfferDeliveryService,
  OfferMessageAdapter,
  OfferMessageReference,
} from '../services/offer-delivery-service.js';
import type { OfferResponseService } from '../services/offer-response-service.js';
import { formatTeamIdentity } from '../domain/team-label.js';
import type {
  DeferredInteractionResponse,
  EditedInteractionResponse,
  SafeInteractionResponse,
} from './types.js';
import { parseOfferCustomId } from './offer-custom-id.js';

export interface OfferButtonInteraction {
  customId: string;
  userId: string;
  channelId: string;
  messageId: string;
  replied: boolean;
  deferred: boolean;
  reply(response: SafeInteractionResponse): Promise<void>;
  deferReply(response: DeferredInteractionResponse): Promise<void>;
  editReply(response: EditedInteractionResponse): Promise<void>;
  followUp(response: SafeInteractionResponse): Promise<void>;
}

export class OfferButtonHandler {
  public constructor(
    private readonly responses: Pick<OfferResponseService, 'acceptOffer' | 'declineOffer'>,
    private readonly delivery: Pick<OfferDeliveryService, 'recordMessageUpdateFailure'>,
    private readonly messages: OfferMessageAdapter,
    private readonly logger: Logger,
  ) {}

  public async handle(interaction: OfferButtonInteraction): Promise<boolean> {
    const parsed = parseOfferCustomId(interaction.customId);
    if (parsed === null) return false;
    const reference: OfferMessageReference = {
      channelId: interaction.channelId,
      messageId: interaction.messageId,
    };
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      if (parsed.action === 'accept') {
        const result = await this.responses.acceptOffer({
          offerId: parsed.offerId,
          respondingDiscordUserId: interaction.userId,
          discordChannelId: interaction.channelId,
          discordMessageId: interaction.messageId,
        });
        await this.updateAfterDatabaseSuccess(
          result.offer,
          interaction.userId,
          reference,
          'ACCEPTED',
          `${result.player.discordUserId === interaction.userId ? `<@${interaction.userId}>` : 'The player'} joined ${formatTeamIdentity(result.destinationClub, 'message')} as a ${result.transactionType.toLowerCase()}.`,
        );
        await this.respond(interaction, 'Offer accepted successfully.');
      } else {
        const offer = await this.responses.declineOffer({
          offerId: parsed.offerId,
          respondingDiscordUserId: interaction.userId,
          discordChannelId: interaction.channelId,
          discordMessageId: interaction.messageId,
        });
        await this.updateAfterDatabaseSuccess(offer, interaction.userId, reference, 'DECLINED');
        await this.respond(interaction, 'Offer declined.');
      }
      return true;
    } catch (error: unknown) {
      if (error instanceof OfferExpiredError) {
        await this.messages.setTerminalState(reference, 'EXPIRED').catch((updateError: unknown) => {
          this.logger.error('expired offer message update failed', updateError, {
            offerId: parsed.offerId,
          });
        });
      }
      throw error;
    }
  }

  private async updateAfterDatabaseSuccess(
    offer: Offer,
    actorDiscordUserId: string,
    reference: OfferMessageReference,
    state: 'ACCEPTED' | 'DECLINED',
    detail?: string,
  ): Promise<void> {
    try {
      await this.messages.setTerminalState(reference, state, detail);
    } catch (error: unknown) {
      this.logger.error('offer message terminal update failed', error, {
        offerId: offer.id,
        state,
      });
      await this.delivery.recordMessageUpdateFailure(offer, actorDiscordUserId, state);
    }
  }

  private async respond(interaction: OfferButtonInteraction, content: string): Promise<void> {
    const response = { content, flags: MessageFlags.Ephemeral } as const;
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ content });
    } else if (interaction.replied) {
      await interaction.followUp(response);
    } else {
      await interaction.reply(response);
    }
  }
}
