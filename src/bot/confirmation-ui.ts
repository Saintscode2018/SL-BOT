import type { EmbedBuilder } from 'discord.js';

import type { ConfirmationRegistry } from '../services/confirmation-registry.js';
import { createErrorEmbed, createWarningEmbed } from './embeds.js';
import { BOT_EMOJIS } from './presentation/index.js';
import type { ButtonInteractionAdapter } from './types.js';

export interface ConfirmationEmbedOptions {
  title?: string;
  description?: string;
}

export function createConfirmationCancelledEmbed(options?: ConfirmationEmbedOptions): EmbedBuilder {
  return createWarningEmbed({
    title: options?.title ?? `${BOT_EMOJIS.warning} Action Cancelled`,
    description: options?.description ?? 'No roster or Discord role changes were made.',
  });
}

export function createConfirmationExpiredEmbed(options?: ConfirmationEmbedOptions): EmbedBuilder {
  return createErrorEmbed({
    title: options?.title ?? `${BOT_EMOJIS.error} Confirmation Expired`,
    description:
      options?.description ??
      'This confirmation expired after two minutes. Run the command again to retry.',
  });
}

export async function handleConfirmationCancel(
  interaction: ButtonInteractionAdapter,
  confirmations: Pick<ConfirmationRegistry, 'cancel'>,
  now: Date,
  embedOptions?: ConfirmationEmbedOptions,
): Promise<boolean> {
  if (!interaction.customId.endsWith(':cancel')) return false;

  confirmations.cancel(interaction.customId, interaction.userId, now, interaction.guildId);
  await interaction.deferUpdate();
  await interaction.editReply({
    embeds: [createConfirmationCancelledEmbed(embedOptions)],
    components: [],
  });
  return true;
}
