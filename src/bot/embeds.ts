import { EmbedBuilder, type APIEmbedField } from 'discord.js';

export interface EmbedOptions {
  title: string;
  description?: string;
  fields?: APIEmbedField[];
  thumbnail?: string | null;
  footer?: string;
}

export const EMBED_COLORS = {
  SUCCESS: 0x57f287, // Discord Green
  INFO: 0x5865f2, // Discord Blurple
  WARNING: 0xfee75c, // Discord Yellow
  ERROR: 0xed4245, // Discord Red
} as const;

export function createSuccessEmbed(options: EmbedOptions): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(options.title).setColor(EMBED_COLORS.SUCCESS);

  if (options.description) embed.setDescription(options.description);
  if (options.fields && options.fields.length > 0) embed.addFields(options.fields);
  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  if (options.footer) embed.setFooter({ text: options.footer });

  return embed;
}

export function createInfoEmbed(options: EmbedOptions): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(options.title).setColor(EMBED_COLORS.INFO);

  if (options.description) embed.setDescription(options.description);
  if (options.fields && options.fields.length > 0) embed.addFields(options.fields);
  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  if (options.footer) embed.setFooter({ text: options.footer });

  return embed;
}

export function createWarningEmbed(options: EmbedOptions): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(options.title).setColor(EMBED_COLORS.WARNING);

  if (options.description) embed.setDescription(options.description);
  if (options.fields && options.fields.length > 0) embed.addFields(options.fields);
  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  if (options.footer) embed.setFooter({ text: options.footer });

  return embed;
}

export function createErrorEmbed(options: EmbedOptions): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(options.title).setColor(EMBED_COLORS.ERROR);

  if (options.description) embed.setDescription(options.description);
  if (options.fields && options.fields.length > 0) embed.addFields(options.fields);
  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  if (options.footer) embed.setFooter({ text: options.footer });

  return embed;
}
