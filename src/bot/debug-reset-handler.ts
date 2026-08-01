import type { PrismaClient } from '@prisma/client';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';

import { AuthorizationError, ConfigurationError } from '../domain/errors.js';
import { createErrorEmbed, createSuccessEmbed, createWarningEmbed } from './embeds.js';

export const DEBUG_RESET_CONFIRM_CUSTOM_ID_PREFIX = 'debugreset_confirm_';
export const DEBUG_RESET_CANCEL_CUSTOM_ID_PREFIX = 'debugreset_cancel_';

export async function sendDebugResetPrompt(
  interaction: ChatInputCommandInteraction,
  database: PrismaClient,
): Promise<void> {
  if (process.env['SLBOT_ENABLE_DEBUG_COMMANDS'] !== 'true') {
    throw new ConfigurationError('the debugreset command is disabled');
  }

  if (!interaction.memberPermissions?.has('Administrator')) {
    throw new AuthorizationError('only Discord Administrators can execute debugreset');
  }

  const userId = interaction.user.id;
  const customIdConfirm = `${DEBUG_RESET_CONFIRM_CUSTOM_ID_PREFIX}${userId}`;
  const customIdCancel = `${DEBUG_RESET_CANCEL_CUSTOM_ID_PREFIX}${userId}`;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(customIdConfirm)
      .setLabel('Confirm Reset')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(customIdCancel)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );

  const embed = createWarningEmbed({
    title: '❌ Reset Debug Database?',
    description:
      'This will permanently delete all SL Bot league data for this server, including teams, memberships, staff appointments, offers, transactions, settings and audit history.\n\nThis action cannot be undone.',
  });

  const response = await interaction.reply({
    embeds: [embed],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });

  try {
    const confirmation = await response.awaitMessageComponent({
      filter: (i: ButtonInteraction) =>
        i.user.id === userId && (i.customId === customIdConfirm || i.customId === customIdCancel),
      componentType: ComponentType.Button,
      time: 60_000,
    });

    if (confirmation.user.id !== userId) {
      await confirmation.reply({
        embeds: [
          createErrorEmbed({
            title: '❌ Permission Denied',
            description: 'Only the user who initiated /debugreset can confirm it.',
          }),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (confirmation.customId === customIdCancel) {
      await confirmation.update({
        embeds: [
          createErrorEmbed({
            title: '❌ Debug Reset Cancelled',
            description: 'No data was deleted.',
          }),
        ],
        components: [],
      });
      return;
    }

    // recheck admin permission
    if (!confirmation.memberPermissions?.has('Administrator')) {
      await confirmation.update({
        embeds: [
          createErrorEmbed({
            title: '❌ Permission Denied',
            description: 'Administrator permission is required.',
          }),
        ],
        components: [],
      });
      return;
    }

    const discordGuildId = interaction.guildId;
    if (!discordGuildId) {
      throw new ConfigurationError('this command must be used in a Discord server');
    }

    await performGuildDebugReset(database, discordGuildId);

    await confirmation.update({
      embeds: [
        createSuccessEmbed({
          title: '✅ Debug Data Reset',
          description:
            'All SL Bot data for this server has been removed.\n\nThe server can now be configured again with /setup league.',
        }),
      ],
      components: [],
    });
  } catch {
    await interaction
      .editReply({
        embeds: [
          createErrorEmbed({
            title: '❌ Reset Confirmation Expired',
            description: 'The debug reset confirmation timed out with no action taken.',
          }),
        ],
        components: [],
      })
      .catch(() => undefined);
  }
}

export async function performGuildDebugReset(
  database: PrismaClient,
  discordGuildId: string,
): Promise<void> {
  await database.$transaction(async (tx) => {
    const guild = await tx.guild.findUnique({
      where: { discordGuildId },
    });
    if (!guild) return;

    // delete in foreign key order
    await tx.auditEvent.deleteMany({ where: { guildId: guild.id } });
    await tx.leagueTransaction.deleteMany({ where: { guildId: guild.id } });
    await tx.offer.deleteMany({ where: { guildId: guild.id } });
    await tx.clubMembership.deleteMany({ where: { guildId: guild.id } });
    await tx.club.deleteMany({ where: { guildId: guild.id } });
    await tx.guildSettings.deleteMany({ where: { guildId: guild.id } });
    await tx.guild.deleteMany({ where: { id: guild.id } });
  });
}
