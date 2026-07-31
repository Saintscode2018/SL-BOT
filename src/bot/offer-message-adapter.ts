import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  type Client,
  type Message,
  type MessageCreateOptions,
  type NewsChannel,
  type TextChannel,
} from 'discord.js';

import { OfferDeliveryError } from '../domain/errors.js';
import type {
  OfferMessageAdapter,
  OfferMessageReference,
} from '../services/offer-delivery-service.js';
import type { OfferCreationResult } from '../services/offer-creation-service.js';
import { createOfferCustomId } from './offer-custom-id.js';

const neutralColor = 0x5865f2;

function offerComponents(offerId: string, disabled = false): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(createOfferCustomId('accept', offerId))
        .setLabel('Accept')
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(createOfferCustomId('decline', offerId))
        .setLabel('Decline')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled),
    ),
  ];
}

function offerEmbed(result: OfferCreationResult): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(neutralColor)
    .setTitle(`Offer from ${result.destinationClub.name}`)
    .setDescription(`<@${result.player.discordUserId}>, you have received a league offer.`)
    .addFields(
      { name: 'Team', value: result.destinationClub.name, inline: true },
      {
        name: 'Current team',
        value: result.sourceClub?.name ?? 'Free agent',
        inline: true,
      },
      { name: 'Offered by', value: `<@${result.offeredBy.discordUserId}>`, inline: true },
      {
        name: 'Expires',
        value: `<t:${Math.floor(result.offer.expiresAt.getTime() / 1000)}:R>`,
        inline: true,
      },
    );
}

function isTextChannel(channel: unknown): channel is TextChannel | NewsChannel {
  return (
    typeof channel === 'object' &&
    channel !== null &&
    'type' in channel &&
    (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement)
  );
}

export class DiscordOfferMessageAdapter implements OfferMessageAdapter {
  public constructor(private readonly client: Client) {}

  public async sendOffer(result: OfferCreationResult): Promise<OfferMessageReference> {
    const channel = await this.client.channels.fetch(result.transferChannelId);
    if (!isTextChannel(channel)) throw new OfferDeliveryError('transfer channel is not sendable');
    const message = await channel.send(createOfferMessagePayload(result));
    return { channelId: message.channelId, messageId: message.id };
  }

  public async setTerminalState(
    reference: OfferMessageReference,
    state: 'ACCEPTED' | 'DECLINED' | 'EXPIRED',
    detail?: string,
  ): Promise<void> {
    const message = await this.fetchMessage(reference);
    const embed = new EmbedBuilder()
      .setColor(state === 'ACCEPTED' ? 0x57f287 : state === 'DECLINED' ? 0xed4245 : 0x747f8d)
      .setTitle(`Offer ${state.toLowerCase()}`)
      .setDescription(detail ?? `This offer is now ${state.toLowerCase()}.`);
    await message.edit({ embeds: [embed], components: [] });
  }

  public async cleanupOrphan(reference: OfferMessageReference): Promise<void> {
    const message = await this.fetchMessage(reference);
    await message
      .delete()
      .catch(async () => message.edit({ components: [] }).then(() => undefined));
  }

  private async fetchMessage(reference: OfferMessageReference): Promise<Message> {
    const channel = await this.client.channels.fetch(reference.channelId);
    if (!isTextChannel(channel) || !('messages' in channel)) {
      throw new OfferDeliveryError('offer channel cannot fetch messages');
    }
    return channel.messages.fetch(reference.messageId);
  }
}

export function createOfferMessagePayload(result: OfferCreationResult): MessageCreateOptions {
  return {
    content: `<@${result.player.discordUserId}>`,
    allowedMentions: {
      users: [result.player.discordUserId],
      roles: [],
      repliedUser: false,
    },
    embeds: [offerEmbed(result)],
    components: offerComponents(result.offer.id),
  };
}
