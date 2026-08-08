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
import type { SetupAuditService } from '../services/setup-audit-service.js';
import {
  createErrorEmbed,
  createSuccessEmbed,
  createWarningEmbed,
  formatRosterAdminWarning,
} from './embeds.js';
import { BOT_EMOJIS } from './presentation/index.js';

export const DEBUG_RESET_CONFIRM_CUSTOM_ID_PREFIX = 'debugreset_confirm_';
export const DEBUG_RESET_CANCEL_CUSTOM_ID_PREFIX = 'debugreset_cancel_';

export async function sendDebugResetPrompt(
  interaction: ChatInputCommandInteraction,
  database: PrismaClient,
  setupAuditService?: Pick<SetupAuditService, 'publish'>,
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
    title: `${BOT_EMOJIS.error} Reset Debug Database?`,
    description:
      'This will permanently delete all SL Bot league data for this server, including teams, memberships, staff appointments, offers, transactions, settings and audit history.\n\nThis action cannot be undone.',
  });

  const response = await interaction.reply({
    embeds: [embed],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });

  let confirmation: ButtonInteraction;
  try {
    confirmation = await response.awaitMessageComponent({
      filter: (i: ButtonInteraction) =>
        i.user.id === userId && (i.customId === customIdConfirm || i.customId === customIdCancel),
      componentType: ComponentType.Button,
      time: 60_000,
    });
  } catch {
    await interaction
      .editReply({
        embeds: [
          createErrorEmbed({
            title: `${BOT_EMOJIS.error} Reset Confirmation Expired`,
            description: 'The debug reset confirmation timed out with no action taken.',
          }),
        ],
        components: [],
      })
      .catch(() => undefined);
    return;
  }

  if (confirmation.user.id !== userId) {
    await confirmation.reply({
      embeds: [
        createErrorEmbed({
          title: `${BOT_EMOJIS.error} Permission Denied`,
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
          title: `${BOT_EMOJIS.error} Debug Reset Cancelled`,
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
          title: `${BOT_EMOJIS.error} Permission Denied`,
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

  const guildWithSettings = await database.guild.findUnique({
    where: { discordGuildId },
    select: {
      settings: {
        select: {
          auditChannelId: true,
        },
      },
    },
  });
  const auditChannelId = guildWithSettings?.settings?.auditChannelId ?? null;

  await performGuildDebugReset(database, discordGuildId);

  let auditDelivered: boolean | undefined = undefined;
  if (auditChannelId !== null && setupAuditService !== undefined) {
    auditDelivered = await setupAuditService.publish({
      channelId: auditChannelId,
      title: 'Debug Reset Completed',
      description: 'Development/debug data for this server was reset successfully.',
      fields: [],
      actorDiscordUserId: userId,
      timestamp: new Date(),
      actorVerb: 'Reset',
    });
  }

  const warning = formatRosterAdminWarning(
    undefined,
    auditDelivered,
    'All SL Bot data for this server was removed',
  );
  const baseDescription =
    'All SL Bot data for this server has been removed.\n\nThe server can now be configured again with /setup league.';
  const description = warning !== null ? `${baseDescription}\n\n${warning}` : baseDescription;

  await confirmation.update({
    embeds: [
      createSuccessEmbed({
        title: `${BOT_EMOJIS.success} Debug Data Reset`,
        description,
      }),
    ],
    components: [],
  });
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
