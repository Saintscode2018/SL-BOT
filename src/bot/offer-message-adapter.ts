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
import { formatTeamBanner, teamBannerConfigFrom } from '../domain/team-label.js';
import type {
  OfferMessageAdapter,
  OfferMessageReference,
} from '../services/offer-delivery-service.js';
import type { OfferCreationResult } from '../services/offer-creation-service.js';
import { createOfferCustomId } from './offer-custom-id.js';
import { getTeamThumbnail } from './emoji-helper.js';

const neutralColor = 0x5865f2;

function offerComponents(offerId: string, disabled = false): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(createOfferCustomId('accept', offerId))
        .setLabel('Sign Contract')
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(createOfferCustomId('decline', offerId))
        .setLabel('Decline Offer')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),
    ),
  ];
}

function offerEmbed(result: OfferCreationResult): EmbedBuilder {
  const expiresAt = Math.floor(result.offer.expiresAt.getTime() / 1000);
  const remainingSpots = Math.max(0, result.effectiveSquadLimit - result.activePlayerCount);
  const embed = new EmbedBuilder()
    .setColor(neutralColor)
    .setTitle(`${result.leagueName || 'SL League'} Contract Offer`)
    .setDescription('Professional First Team')
    .addFields(
      {
        name: 'Destination Club',
        value: formatTeamBanner(result.destinationClub, teamBannerConfigFrom(result.bannerConfig)),
        inline: true,
      },
      { name: 'Offered Player', value: `<@${result.player.discordUserId}>`, inline: true },
      { name: 'Offering Manager', value: `<@${result.offeredBy.discordUserId}>`, inline: true },
      {
        name: 'Squad',
        value: `${result.activePlayerCount}/${result.effectiveSquadLimit}`,
        inline: true,
      },
      { name: 'Remaining Spots', value: String(remainingSpots), inline: true },
      {
        name: 'Current Club',
        value: result.sourceClub
          ? formatTeamBanner(result.sourceClub, teamBannerConfigFrom(result.bannerConfig))
          : 'Free agent',
        inline: true,
      },
      { name: 'Expires', value: `<t:${expiresAt}:F>\n<t:${expiresAt}:R>` },
    );
  const thumbnail = getTeamThumbnail(result.destinationClub.emoji, result.destinationClub.logoUrl);
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

  public async sendOffer(result: OfferCreationResult): Promise<OfferMessageReference> {
    const user = await this.client.users.fetch(result.player.discordUserId);
    const channel = await user.createDM();
    const message = await channel.send(createOfferMessagePayload(result));
    return { channelId: message.channelId, messageId: message.id };
  }

  public async setTerminalState(
    reference: OfferMessageReference,
    state: 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'VOIDED' | 'CANCELLED',
    detail?: string,
  ): Promise<void> {
    const message = await this.fetchMessage(reference);
    const embed = new EmbedBuilder()
      .setColor(state === 'ACCEPTED' ? 0x57f287 : state === 'DECLINED' ? 0xed4245 : 0x747f8d)
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

export function createOfferMessagePayload(result: OfferCreationResult): MessageCreateOptions {
  return {
    allowedMentions: {
      parse: [],
      users: [],
      roles: [],
      repliedUser: false,
    },
    embeds: [offerEmbed(result)],
    components: offerComponents(result.offer.id),
  };
}
