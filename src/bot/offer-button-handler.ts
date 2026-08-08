import type { Offer } from '@prisma/client';
import { MessageFlags } from 'discord.js';

import { OfferExpiredError } from '../domain/errors.js';
import type { Logger } from '../logging/logger.js';
import type {
  OfferDeliveryService,
  OfferMessageAdapter,
  OfferMessageReference,
  TerminalOfferPresentationPayload,
} from '../services/offer-delivery-service.js';
import type { OfferResponseService } from '../services/offer-response-service.js';
import type {
  DeferredInteractionResponse,
  EditedInteractionResponse,
  GuildRoleMetadata,
  SafeInteractionResponse,
} from './types.js';
import { formatRosterAdminWarning } from './embeds.js';
import { parseOfferCustomId } from './offer-custom-id.js';

export interface OfferButtonInteraction {
  customId: string;
  userId: string;
  channelId: string;
  messageId: string;
  replied: boolean;
  deferred: boolean;
  guildName?: string | undefined;
  guildIconUrl?: string | undefined;
  getGuildRoleMetadata?(roleId: string): { id: string; name: string; color: number } | null;
  getGuildMemberDisplayName?(userId: string): string | null;
  resolveGuildRoleMetadata?(roleId: string): Promise<GuildRoleMetadata | null>;
  resolveGuildMemberDisplayName?(userId: string): Promise<string | null>;
  reply(response: SafeInteractionResponse): Promise<void>;
  deferReply(response: DeferredInteractionResponse): Promise<void>;
  deferUpdate?(): Promise<void>;
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

    if (parsed.action === 'decline') {
      await interaction.deferUpdate?.();
      try {
        const declineResult = await this.responses.declineOffer({
          offerId: parsed.offerId,
          respondingDiscordUserId: interaction.userId,
          discordChannelId: interaction.channelId,
          discordMessageId: interaction.messageId,
        });

        const roleMeta = declineResult.destinationClub?.discordRoleId
          ? await this.resolveRole(interaction, declineResult.destinationClub.discordRoleId)
          : null;
        const teamRoleName = roleMeta?.name?.trim().replace(/^@+/u, '') ?? null;
        const tmUserId = declineResult.teamManagerDiscordUserId ?? null;
        const tmUsername = tmUserId ? await this.resolveUser(interaction, tmUserId) : null;

        const presentationPayload: TerminalOfferPresentationPayload = {
          state: 'DECLINED',
          guildName: interaction.guildName ?? declineResult.guildName ?? null,
          guildIconUrl: interaction.guildIconUrl ?? null,
          teamRoleName,
          teamEmoji: declineResult.destinationClub?.emoji ?? '',
          teamDiscordRoleId: declineResult.destinationClub?.discordRoleId ?? '',
          tmUserId,
          tmUsername,
          activePlayerCount: declineResult.activePlayerCount ?? 0,
          effectiveSquadLimit: declineResult.effectiveSquadLimit ?? 17,
        };

        const targetOffer =
          declineResult && 'offer' in declineResult
            ? declineResult.offer
            : (declineResult as unknown as Offer);

        await this.updateAfterDatabaseSuccess(
          targetOffer,
          interaction.userId,
          reference,
          'DECLINED',
          presentationPayload,
        );
        const warning = formatRosterAdminWarning(
          undefined,
          declineResult.auditAnnouncementDelivered,
          'The offer was declined',
        );
        if (warning) {
          await interaction
            .followUp({ content: warning, flags: MessageFlags.Ephemeral })
            .catch((err: unknown) => {
              this.logger.error('failed to send decline audit warning followUp', err);
            });
        }
        return true;
      } catch (error: unknown) {
        if (error instanceof OfferExpiredError) {
          await this.messages
            .setTerminalState(reference, 'EXPIRED')
            .catch((updateError: unknown) => {
              this.logger.error('expired offer message update failed', updateError, {
                offerId: parsed.offerId,
              });
            });
        }
        throw error;
      }
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const result = await this.responses.acceptOffer({
        offerId: parsed.offerId,
        respondingDiscordUserId: interaction.userId,
        discordChannelId: interaction.channelId,
        discordMessageId: interaction.messageId,
      });

      const roleMeta = await this.resolveRole(interaction, result.destinationClub.discordRoleId);
      const teamRoleName =
        roleMeta?.name?.trim().replace(/^@+/u, '') ??
        result.acceptedPresentation?.teamRoleName ??
        null;
      const tmUserId = result.acceptedPresentation?.tmUserId ?? null;
      const tmUsername = tmUserId
        ? ((await this.resolveUser(interaction, tmUserId)) ??
          result.acceptedPresentation?.tmUsername ??
          null)
        : null;

      const presentationPayload: TerminalOfferPresentationPayload = {
        state: 'ACCEPTED',
        guildName: interaction.guildName ?? result.acceptedPresentation?.guildName ?? null,
        guildIconUrl: interaction.guildIconUrl ?? result.acceptedPresentation?.guildIconUrl ?? null,
        teamRoleName,
        teamEmoji: result.destinationClub.emoji,
        teamDiscordRoleId: result.destinationClub.discordRoleId,
        tmUserId,
        tmUsername,
        activePlayerCount:
          result.acceptedPresentation?.activePlayerCount ??
          (result.announcement && 'roster' in result.announcement
            ? result.announcement.roster?.currentSize
            : undefined) ??
          1,
        effectiveSquadLimit:
          result.acceptedPresentation?.effectiveSquadLimit ??
          (result.announcement && 'roster' in result.announcement
            ? result.announcement.roster?.maximumSize
            : undefined) ??
          17,
      };

      await this.updateAfterDatabaseSuccess(
        result.offer,
        interaction.userId,
        reference,
        'ACCEPTED',
        presentationPayload,
      );
      const warning = formatRosterAdminWarning(
        result.announcementDelivered,
        result.auditAnnouncementDelivered,
      );
      const responseText = warning
        ? `Offer accepted successfully.\n\n${warning}`
        : 'Offer accepted successfully.';
      await this.respond(interaction, responseText);
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
    detail?: string | TerminalOfferPresentationPayload,
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

  private async resolveRole(
    interaction: OfferButtonInteraction,
    roleId: string,
  ): Promise<GuildRoleMetadata | null> {
    return (
      (await interaction.resolveGuildRoleMetadata?.(roleId)) ??
      interaction.getGuildRoleMetadata?.(roleId) ??
      null
    );
  }

  private async resolveUser(
    interaction: OfferButtonInteraction,
    userId: string,
  ): Promise<string | null> {
    return (
      (await interaction.resolveGuildMemberDisplayName?.(userId)) ??
      interaction.getGuildMemberDisplayName?.(userId) ??
      null
    );
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
