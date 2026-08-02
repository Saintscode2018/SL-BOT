import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ComponentType,
  EmbedBuilder,
  type Client,
  type DMChannel,
  type Message,
  type MessageCreateOptions,
} from 'discord.js';

import { OfferDeliveryError } from '../domain/errors.js';
import { formatTeamIdentity } from '../domain/team-label.js';
import type {
  OfferMessageAdapter,
  OfferMessageReference,
  OfferPresentationMetadata,
} from '../services/offer-delivery-service.js';
import type { OfferCreationResult } from '../services/offer-creation-service.js';
import { createOfferCustomId } from './offer-custom-id.js';
import { getTeamThumbnail } from './emoji-helper.js';
import {
  BOT_COLORS,
  BOT_EMOJIS,
  BOT_LABELS,
  createGuildAuthor,
  formatBlockquote,
  formatDiscordRelative,
  formatUserWithVisibleName,
  resolveTeamRoleColor,
} from './presentation/index.js';

function offerComponents(offerId: string, disabled = false): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(createOfferCustomId('accept', offerId))
        .setEmoji(BOT_EMOJIS.success)
        .setLabel(BOT_LABELS.signContract)
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(createOfferCustomId('decline', offerId))
        .setEmoji(BOT_EMOJIS.error)
        .setLabel(BOT_LABELS.declineOffer)
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),
    ),
  ];
}

function offerEmbed(
  result: OfferCreationResult,
  presentation: OfferPresentationMetadata = {},
): EmbedBuilder {
  const sourceTeam = {
    ...result.destinationClub,
    discordRoleName: presentation.sourceTeamRoleName ?? null,
  };
  const author = createGuildAuthor({
    guildName: presentation.guildName?.trim() || result.leagueName || 'SL League',
    guildIconUrl: presentation.guildIconUrl,
  });

  const managerFormatted = formatUserWithVisibleName(
    result.offeredBy.discordUserId,
    presentation.offeredByUsername || 'Unknown User',
  );

  const detailsPanel = formatBlockquote([
    `${BOT_EMOJIS.teamManager} ${BOT_LABELS.teamManager}: ${managerFormatted}`,
    `${BOT_EMOJIS.roster} ${BOT_LABELS.roster}: ${result.activePlayerCount}/${result.effectiveSquadLimit}`,
    `${BOT_EMOJIS.expiry} ${BOT_LABELS.expires}: ${formatDiscordRelative(result.offer.expiresAt)}`,
  ]);

  const embed = new EmbedBuilder()
    .setColor(resolveTeamRoleColor(presentation.sourceTeamRoleColor, BOT_COLORS.info))
    .setAuthor(author)
    .setTitle(BOT_LABELS.contractOffer)
    .addFields({
      name: BOT_LABELS.sourceTeam,
      value: formatTeamIdentity(sourceTeam, 'title'),
      inline: false,
    })
    .setDescription(detailsPanel);

  const thumbnail = getTeamThumbnail(result.destinationClub.emoji);
  if (thumbnail !== null) {
    embed.setThumbnail(thumbnail);
  }
  return embed;
}

function isDmChannel(channel: unknown): channel is DMChannel {
  return (
    typeof channel === 'object' &&
    channel !== null &&
    'type' in channel &&
    channel.type === ChannelType.DM
  );
}

function disabledComponents(message: Message): ActionRowBuilder<ButtonBuilder>[] {
  return message.components
    .filter((row) => row.type === ComponentType.ActionRow)
    .map((row) =>
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        row.components
          .filter((component) => component.type === ComponentType.Button)
          .map((component) => ButtonBuilder.from(component).setDisabled(true)),
      ),
    );
}

export class DiscordOfferMessageAdapter implements OfferMessageAdapter {
  public constructor(private readonly client: Client) {}

  public async sendOffer(
    result: OfferCreationResult,
    presentation: OfferPresentationMetadata = {},
  ): Promise<OfferMessageReference> {
    const user = await this.client.users.fetch(result.player.discordUserId);
    const channel = await user.createDM();
    const message = await channel.send(createOfferMessagePayload(result, presentation));
    return { channelId: message.channelId, messageId: message.id };
  }

  public async setTerminalState(
    reference: OfferMessageReference,
    state: 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'VOIDED' | 'CANCELLED',
    detail?: string,
  ): Promise<void> {
    const message = await this.fetchMessage(reference);
    const embedColor =
      state === 'ACCEPTED'
        ? BOT_COLORS.success
        : state === 'DECLINED'
          ? BOT_COLORS.error
          : BOT_COLORS.neutral;
    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle(`Offer ${state.toLowerCase()}`)
      .setDescription(detail ?? `This offer is now ${state.toLowerCase()}.`);
    await message.edit({ embeds: [embed], components: disabledComponents(message) });
  }

  public async cleanupOrphan(reference: OfferMessageReference): Promise<void> {
    const message = await this.fetchMessage(reference);
    await message
      .delete()
      .catch(async () =>
        message.edit({ components: disabledComponents(message) }).then(() => undefined),
      );
  }

  private async fetchMessage(reference: OfferMessageReference): Promise<Message> {
    const channel = await this.client.channels.fetch(reference.channelId);
    if (!isDmChannel(channel)) {
      throw new OfferDeliveryError('offer DM channel cannot fetch messages');
    }
    return channel.messages.fetch(reference.messageId);
  }
}

export function createOfferMessagePayload(
  result: OfferCreationResult,
  presentation: OfferPresentationMetadata = {},
): MessageCreateOptions {
  return {
    allowedMentions: {
      parse: [],
      users: [],
      roles: [],
      repliedUser: false,
    },
    embeds: [offerEmbed(result, presentation)],
    components: offerComponents(result.offer.id),
  };
}
