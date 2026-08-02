import { EmbedBuilder, type APIEmbedField } from 'discord.js';

import { BOT_COLORS, EMBED_COLORS } from './presentation/colors.js';

export { EMBED_COLORS };

export interface EmbedOptions {
  title?: string;
  color?: number;
  description?: string;
  fields?: APIEmbedField[];
  thumbnail?: string | null;
  footer?: string;
  footerIconURL?: string | null;
  author?: { name: string; iconURL?: string } | null;
  timestamp?: Date;
}

export function createActorField(
  verb: 'Configured' | 'Updated' | 'Added' | 'Removed' | 'Appointed' | 'Edited' | 'Reset',
  userId: string,
): APIEmbedField {
  return {
    name: `${verb} by`,
    value: `<@${userId}>`,
    inline: false,
  };
}

export function createSuccessEmbed(options: EmbedOptions & { title: string }): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(options.title)
    .setColor(options.color ?? BOT_COLORS.success);

  if (options.author) {
    embed.setAuthor({
      name: options.author.name,
      ...(options.author.iconURL ? { iconURL: options.author.iconURL } : {}),
    });
  }
  if (options.description) embed.setDescription(options.description);
  if (options.fields && options.fields.length > 0) embed.addFields(options.fields);
  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  if (options.footer)
    embed.setFooter({
      text: options.footer,
      ...(options.footerIconURL ? { iconURL: options.footerIconURL } : {}),
    });
  if (options.timestamp) embed.setTimestamp(options.timestamp);

  return embed;
}

export function createInfoEmbed(options: EmbedOptions): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(options.color ?? BOT_COLORS.info);

  if (options.title) embed.setTitle(options.title);
  if (options.author) {
    embed.setAuthor({
      name: options.author.name,
      ...(options.author.iconURL ? { iconURL: options.author.iconURL } : {}),
    });
  }
  if (options.description) embed.setDescription(options.description);
  if (options.fields && options.fields.length > 0) embed.addFields(options.fields);
  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  if (options.footer)
    embed.setFooter({
      text: options.footer,
      ...(options.footerIconURL ? { iconURL: options.footerIconURL } : {}),
    });
  if (options.timestamp) embed.setTimestamp(options.timestamp);

  return embed;
}

export function createWarningEmbed(options: EmbedOptions & { title: string }): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(options.title).setColor(BOT_COLORS.warning);

  if (options.author) {
    embed.setAuthor({
      name: options.author.name,
      ...(options.author.iconURL ? { iconURL: options.author.iconURL } : {}),
    });
  }
  if (options.description) embed.setDescription(options.description);
  if (options.fields && options.fields.length > 0) embed.addFields(options.fields);
  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  if (options.footer)
    embed.setFooter({
      text: options.footer,
      ...(options.footerIconURL ? { iconURL: options.footerIconURL } : {}),
    });
  if (options.timestamp) embed.setTimestamp(options.timestamp);

  return embed;
}

export function createErrorEmbed(options: EmbedOptions & { title: string }): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(options.title).setColor(BOT_COLORS.error);

  if (options.author) {
    embed.setAuthor({
      name: options.author.name,
      ...(options.author.iconURL ? { iconURL: options.author.iconURL } : {}),
    });
  }
  if (options.description) embed.setDescription(options.description);
  if (options.fields && options.fields.length > 0) embed.addFields(options.fields);
  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  if (options.footer)
    embed.setFooter({
      text: options.footer,
      ...(options.footerIconURL ? { iconURL: options.footerIconURL } : {}),
    });
  if (options.timestamp) embed.setTimestamp(options.timestamp);

  return embed;
}
