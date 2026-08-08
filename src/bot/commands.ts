import { ChannelType, MessageFlags, SlashCommandBuilder } from 'discord.js';

import { ConfigurationError, DiscordRoleMissingError, ValidationError } from '../domain/errors.js';
import { getEffectiveSquadLimit } from '../domain/squad-limit.js';
import { formatTeamIdentity } from '../domain/team-label.js';
import { getFriendlyPositionName, type StaffType } from '../services/staff-management-service.js';
import {
  createActorField,
  createInfoEmbed,
  createSuccessEmbed,
  formatRosterAdminWarning,
} from './embeds.js';
import { demandCommand, releaseCommand } from './departure-command-definitions.js';
import { demoteCommand, promoteCommand } from './promotion-demotion-command-definitions.js';
import { getTeamThumbnail, validateTeamEmoji } from './emoji-helper.js';
import { requireGuildExecution, type GuildCommandExecution } from './guild-execution.js';
import {
  requireChannel,
  requireInteger,
  requireRole,
  requireString,
  requireUser,
} from './option-parsing.js';
import {
  BOT_COLORS,
  BOT_EMOJIS,
  BOT_LABELS,
  createActorFooter,
  createGuildAuthor,
  formatTeamPlainRoleName,
  formatUserWithVisibleName,
  getUserDisplayName,
} from './presentation/index.js';
import { getTeamEmbedColor, resolveTeamPresentation } from './team-presentation.js';
import {
  chunkTeamHealthLines,
  formatCompactTeamHealthLine,
  formatDetailedTeamHealthDescription,
} from './team-health-presentation.js';
import { formatFranchiseOwnerListLine } from './franchise-owner-list-presentation.js';
import type {
  CommandAutocompleteInteraction,
  CommandContext,
  CommandDefinition,
  CommandInteraction,
} from './types.js';

async function enforceChannelPolicy(
  interaction: CommandInteraction,
  context: CommandContext,
): Promise<GuildCommandExecution> {
  const execution = requireGuildExecution(interaction);
  if (interaction.channelId === undefined) {
    throw new ConfigurationError('this command must be used in a Discord channel');
  }
  await context.commandChannelPolicyService.validateChannelPolicy({
    authorization: execution.authorization,
    channelId: interaction.channelId,
    commandName: interaction.commandName,
    subcommand: execution.options.getSubcommand(),
  });
  return execution;
}

const auditDeliveryWarning = `${BOT_EMOJIS.warning} Configuration was saved, but the audit message could not be delivered.`;

async function publishSetupAudit(
  context: CommandContext,
  input: {
    channelId: string | null;
    title: string;
    description: string;
    fields: Array<{ name: string; value: string; inline?: boolean }>;
    actorDiscordUserId: string;
    actorVerb?:
      | 'Configured'
      | 'Updated'
      | 'Added'
      | 'Removed'
      | 'Appointed'
      | 'Edited'
      | 'Reset'
      | 'Demanded'
      | 'Released'
      | 'Promoted'
      | 'Demoted'
      | 'Disbanded'
      | undefined;
  },
): Promise<boolean> {
  if (input.channelId === null) return true;
  return context.setupAuditService.publish({
    channelId: input.channelId,
    title: input.title,
    description: input.description,
    fields: input.fields,
    actorDiscordUserId: input.actorDiscordUserId,
    timestamp: new Date(),
    actorVerb: input.actorVerb,
  });
}

function withAuditWarning(description: string, auditPublished: boolean): string {
  return auditPublished ? description : `${description}\n\n${auditDeliveryWarning}`;
}

export { formatRosterAdminWarning };

export function formatStaffDirectoryTeamSection(
  formattedTeamIdentity: string,
  tmFormatted: string,
  atmFormatted: string,
  pmFormatted: string,
): string {
  return [
    formattedTeamIdentity,
    `> ${BOT_EMOJIS.teamManager} ${BOT_LABELS.teamManager}: ${tmFormatted}`,
    `> ${BOT_EMOJIS.assistantTeamManager} ${BOT_LABELS.assistantTeamManager}: ${atmFormatted}`,
    `> ${BOT_EMOJIS.playerManager} ${BOT_LABELS.playerManager}: ${pmFormatted}`,
  ].join('\n');
}

function staffDirectoryBlock(
  staff: ReadonlyArray<{ membershipType: string; user: { discordUserId: string } }>,
  resolvedNames?: ReadonlyMap<string, string | null>,
): { tmFormatted: string; atmFormatted: string; pmFormatted: string } {
  const byType = new Map(staff.map((membership) => [membership.membershipType, membership.user]));
  const getFormatted = (type: string) => {
    const user = byType.get(type);
    return user
      ? formatUserWithVisibleName(
          user.discordUserId,
          resolvedNames?.get(user.discordUserId) ?? 'Unknown User',
        )
      : BOT_LABELS.vacant;
  };
  return {
    tmFormatted: getFormatted('TEAM_MANAGER'),
    atmFormatted: getFormatted('ASSISTANT_MANAGER'),
    pmFormatted: getFormatted('PLAYER_MANAGER'),
  };
}

function renderTeamStaffBlock(
  formattedTeamIdentity: string,
  staff: ReadonlyArray<{ membershipType: string; user: { discordUserId: string } }>,
  resolvedNames?: ReadonlyMap<string, string | null>,
): string {
  const { tmFormatted, atmFormatted, pmFormatted } = staffDirectoryBlock(staff, resolvedNames);
  return formatStaffDirectoryTeamSection(
    formattedTeamIdentity,
    tmFormatted,
    atmFormatted,
    pmFormatted,
  );
}

async function resolveUserDisplayNames(
  interaction: CommandInteraction,
  userIds: Iterable<string>,
): Promise<Map<string, string | null>> {
  const uniqueUserIds = [...new Set(userIds)];
  const entries = await Promise.all(
    uniqueUserIds.map(async (userId) => {
      const asynchronouslyResolved = await interaction.resolveGuildMemberDisplayName?.(userId);
      return [
        userId,
        asynchronouslyResolved?.trim() || getUserDisplayName(interaction, userId),
      ] as const;
    }),
  );
  return new Map(entries);
}

function chunkStaffDirectoryFields(
  fields: Array<{ name: string; value: string; inline: boolean }>,
): Array<typeof fields> {
  const chunks: Array<typeof fields> = [];
  let current: typeof fields = [];
  let currentCharacters = 0;
  for (const field of fields) {
    const fieldCharacters = field.name.length + field.value.length;
    if (current.length === 25 || currentCharacters + fieldCharacters > 5_500) {
      chunks.push(current);
      current = [];
      currentCharacters = 0;
    }
    current.push(field);
    currentCharacters += fieldCharacters;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function chunkRosterPlayerLines(lines: readonly string[]): string[] {
  if (lines.length === 0) return [BOT_LABELS.none];
  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    const candidate = current.length === 0 ? line : `${current}\n${line}`;
    if (candidate.length > 1_024 && current.length > 0) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function validateTextChannel(channel: { id: string; type: number }, name: string): void {
  if (
    channel.type !== Number(ChannelType.GuildText) &&
    channel.type !== Number(ChannelType.GuildAnnouncement)
  ) {
    throw new ValidationError(`${name} must be a text channel`);
  }
}

async function autocompleteTeam(
  interaction: CommandAutocompleteInteraction,
  context: CommandContext,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }

  const roleMetadata = interaction.getGuildRoles?.() ?? [];
  const roleNamesById = Object.fromEntries(roleMetadata.map((role) => [role.id, role.name]));

  const choices = await context.clubManagementService.autocomplete(
    interaction.guildId,
    interaction.focusedValue,
    25,
    roleNamesById,
  );

  await interaction.respond(choices);
}

const healthCommand: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('health')
    .setDescription('Check whether SL Bot is online'),
  async execute(interaction, context) {
    await enforceChannelPolicy(interaction, context);
    const connected = await context.databaseHealth.check().catch(() => false);
    const embed = createInfoEmbed({
      title: 'SL Bot System Health',
      description: 'System operational status and services status.',
      fields: [
        { name: 'Bot Status', value: `Online ${BOT_EMOJIS.success}`, inline: true },
        {
          name: 'Database',
          value: connected ? `Connected ${BOT_EMOJIS.success}` : `Unavailable ${BOT_EMOJIS.error}`,
          inline: true,
        },
      ],
    });
    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });
  },
};

const setupCommand: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure SL Bot for this league')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('league')
        .setDescription('Create or update league settings')
        .addIntegerOption((option) =>
          option
            .setName('offer_timeout_minutes')
            .setDescription('Default offer lifetime in minutes')
            .setMinValue(1)
            .setMaxValue(10080),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('channels')
        .setDescription('Configure required system channels')
        .addChannelOption((option) =>
          option
            .setName('bot_commands')
            .setDescription('Channel for public bot commands')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        )
        .addChannelOption((option) =>
          option
            .setName('staff')
            .setDescription('Channel for staff and administrative commands')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        )
        .addChannelOption((option) =>
          option
            .setName('transfer')
            .setDescription('Channel for public transfer announcements')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        )
        .addChannelOption((option) =>
          option
            .setName('audit')
            .setDescription('Channel for system audit logs')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('roles')
        .setDescription('Configure league management roles')
        .addRoleOption((option) =>
          option
            .setName('bot_permissions')
            .setDescription('Role with global bot administrative permissions')
            .setRequired(true),
        )
        .addRoleOption((option) =>
          option.setName('team_manager').setDescription('Team manager role').setRequired(true),
        )
        .addRoleOption((option) =>
          option
            .setName('assistant_manager')
            .setDescription('Assistant manager role')
            .setRequired(true),
        )
        .addRoleOption((option) =>
          option.setName('player_manager').setDescription('Player manager role').setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('view').setDescription('View current league configuration'),
    ),
  async execute(interaction, context) {
    const execution = await enforceChannelPolicy(interaction, context);
    const subcommand = execution.options.getSubcommand();
    const actorDisplayName = getUserDisplayName(interaction, execution.authorization.discordUserId);

    if (subcommand === 'league') {
      const timeoutMinutes = execution.options.getInteger('offer_timeout_minutes');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await context.guildSetupService.setupGuildOnly({
        authorization: execution.authorization,
        guildName: execution.guildName,
        ...(timeoutMinutes === null ? {} : { offerTimeoutSeconds: timeoutMinutes * 60 }),
      });
      const title = `${BOT_EMOJIS.success} League Settings Updated`;
      const description = `League configuration ${result.created ? 'initialized' : 'updated'} for **${result.guild.name}**.`;
      const auditFields = [
        {
          name: `${BOT_EMOJIS.expiry} Offer Timeout`,
          value: `${Math.round(result.settings.offerTimeoutSeconds / 60)} minutes`,
          inline: false,
        },
      ];
      const auditPublished = await publishSetupAudit(context, {
        channelId: result.settings.auditChannelId,
        title,
        description,
        fields: auditFields,
        actorDiscordUserId: execution.authorization.discordUserId,
      });
      const embed = createSuccessEmbed({
        title,
        description: withAuditWarning(description, auditPublished),
        fields: [
          ...auditFields,
          createActorField('Configured', execution.authorization.discordUserId, actorDisplayName),
        ],
      });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'channels') {
      const botCmds = requireChannel(execution.options, 'bot_commands');
      const staff = requireChannel(execution.options, 'staff');
      const transfer = requireChannel(execution.options, 'transfer');
      const audit = requireChannel(execution.options, 'audit');

      validateTextChannel(botCmds, 'bot_commands');
      validateTextChannel(staff, 'staff');
      validateTextChannel(transfer, 'transfer');
      validateTextChannel(audit, 'audit');

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await context.guildSetupService.setupChannels({
        authorization: execution.authorization,
        guildName: execution.guildName,
        botCommandsChannelId: botCmds.id,
        staffChannelId: staff.id,
        transferChannelId: transfer.id,
        auditChannelId: audit.id,
      });

      const channelBlock = [
        `${BOT_EMOJIS.botCommandsChannel} Bot Commands: <#${botCmds.id}>`,
        `${BOT_EMOJIS.staffCommandsChannel} Staff Commands: <#${staff.id}>`,
        `${BOT_EMOJIS.transferMarketChannel} Transfers: <#${transfer.id}>`,
        `${BOT_EMOJIS.auditChannel} Audit Logs: <#${audit.id}>`,
      ].join('\n');

      const title = `${BOT_EMOJIS.success} System Channels Configured`;
      const description = 'Successfully updated channel configuration for the league.';
      const auditFields = [{ name: 'Channels', value: channelBlock, inline: false }];
      const auditPublished = await publishSetupAudit(context, {
        channelId: result.settings.auditChannelId,
        title,
        description,
        fields: auditFields,
        actorDiscordUserId: execution.authorization.discordUserId,
      });
      const embed = createSuccessEmbed({
        title,
        description: withAuditWarning(description, auditPublished),
        fields: [
          ...auditFields,
          createActorField('Configured', execution.authorization.discordUserId, actorDisplayName),
        ],
      });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'roles') {
      const botPerms = requireRole(execution.options, 'bot_permissions');
      const tm = requireRole(execution.options, 'team_manager');
      const atm = requireRole(execution.options, 'assistant_manager');
      const pm = requireRole(execution.options, 'player_manager');

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await context.guildSetupService.setupRoles({
        authorization: execution.authorization,
        guildName: execution.guildName,
        botPermissionsRoleId: botPerms.id,
        teamManagerRoleId: tm.id,
        assistantManagerRoleId: atm.id,
        playerManagerRoleId: pm.id,
      });

      const roleBlock = [
        `${BOT_EMOJIS.botPermissions} Bot Permissions: <@&${botPerms.id}>`,
        `${BOT_EMOJIS.teamManager} ${BOT_LABELS.teamManager}: <@&${tm.id}>`,
        `${BOT_EMOJIS.assistantTeamManager} ${BOT_LABELS.assistantTeamManager}: <@&${atm.id}>`,
        `${BOT_EMOJIS.playerManager} ${BOT_LABELS.playerManager}: <@&${pm.id}>`,
      ].join('\n');

      const title = `${BOT_EMOJIS.success} League Roles Configured`;
      const description = 'Successfully updated role configuration for the league.';
      const auditFields = [{ name: 'Roles', value: roleBlock, inline: false }];
      const auditPublished = await publishSetupAudit(context, {
        channelId: result.settings.auditChannelId,
        title,
        description,
        fields: auditFields,
        actorDiscordUserId: execution.authorization.discordUserId,
      });
      const embed = createSuccessEmbed({
        title,
        description: withAuditWarning(description, auditPublished),
        fields: [
          ...auditFields,
          createActorField('Configured', execution.authorization.discordUserId, actorDisplayName),
        ],
      });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'view') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const view = await context.guildSetupService.getView(execution.guildId);

      const channelLines = [
        `${BOT_EMOJIS.botCommandsChannel} Bot Commands: ${view.channels.botCommandsChannelId ? `<#${view.channels.botCommandsChannelId}>` : 'Not configured'}`,
        `${BOT_EMOJIS.staffCommandsChannel} Staff Commands: ${view.channels.staffChannelId ? `<#${view.channels.staffChannelId}>` : 'Not configured'}`,
        `${BOT_EMOJIS.transferMarketChannel} Transfers: ${view.channels.transferChannelId ? `<#${view.channels.transferChannelId}>` : 'Not configured'}`,
        `${BOT_EMOJIS.auditChannel} Audit Logs: ${view.channels.auditChannelId ? `<#${view.channels.auditChannelId}>` : 'Not configured'}`,
      ].join('\n');

      const roleLines = [
        `${BOT_EMOJIS.botPermissions} Bot Permissions: ${view.roles.botPermissionsRoleId ? `<@&${view.roles.botPermissionsRoleId}>` : 'Not configured'}`,
        `${BOT_EMOJIS.teamManager} ${BOT_LABELS.teamManager}: ${view.roles.teamManagerRoleId ? `<@&${view.roles.teamManagerRoleId}>` : 'Not configured'}`,
        `${BOT_EMOJIS.assistantTeamManager} ${BOT_LABELS.assistantTeamManager}: ${view.roles.assistantManagerRoleId ? `<@&${view.roles.assistantManagerRoleId}>` : 'Not configured'}`,
        `${BOT_EMOJIS.playerManager} ${BOT_LABELS.playerManager}: ${view.roles.playerManagerRoleId ? `<@&${view.roles.playerManagerRoleId}>` : 'Not configured'}`,
      ].join('\n');

      const missingText =
        view.missingConfigurations.length === 0
          ? `${BOT_LABELS.none} (Complete)`
          : view.missingConfigurations.join(', ');

      const embed = createSuccessEmbed({
        title: `${BOT_EMOJIS.success} League Configuration — ${view.guildName}`,
        fields: [
          { name: 'Channels', value: channelLines, inline: false },
          { name: 'Roles', value: roleLines, inline: false },
          {
            name: 'Settings',
            value: `👥 Default Squad Limit: ${view.defaultSquadLimit}\n${BOT_EMOJIS.expiry} Offer Lifetime: ${view.offerTimeoutMinutes} minutes`,
            inline: false,
          },
          { name: 'Missing Configuration', value: missingText, inline: false },
        ],
      });

      await interaction.editReply({ embeds: [embed] });
    }
  },
};

const teamCommand: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('team')
    .setDescription('Manage league teams')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Register a team linked to an existing role')
        .addRoleOption((option) =>
          option.setName('role').setDescription('Existing team role').setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('emoji')
            .setDescription('Custom or standard emoji for team branding')
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('edit')
        .setDescription('Edit existing team properties')
        .addStringOption((option) =>
          option
            .setName('team')
            .setDescription('Team to edit')
            .setAutocomplete(true)
            .setRequired(true),
        )
        .addRoleOption((option) => option.setName('role').setDescription('New team role'))
        .addStringOption((option) =>
          option.setName('emoji').setDescription('New custom or standard emoji for team branding'),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('disband')
        .setDescription('Permanently disband an active team while preserving its identity')
        .addStringOption((option) =>
          option
            .setName('team')
            .setDescription('Team to disband')
            .setAutocomplete(true)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) => subcommand.setName('list').setDescription('List active teams')),
  async execute(interaction, context) {
    if (interaction.options?.getSubcommand() === 'disband') {
      if (context.teamDisbandmentCommandHandler === undefined) {
        throw new ConfigurationError('team disbandment handler is unavailable');
      }
      await context.teamDisbandmentCommandHandler.begin(interaction);
      return;
    }

    const execution = await enforceChannelPolicy(interaction, context);
    const subcommand = execution.options.getSubcommand();
    const guildEmojis = interaction.getGuildEmojis?.() ?? [];
    const actorDisplayName = getUserDisplayName(interaction, execution.authorization.discordUserId);

    if (subcommand === 'add') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const rawEmoji = requireString(execution.options, 'emoji');
      const validatedEmoji = validateTeamEmoji(rawEmoji, guildEmojis);
      const role = requireRole(execution.options, 'role');

      const club = await context.clubManagementService.create({
        authorization: execution.authorization,
        discordRoleId: role.id,
        emoji: validatedEmoji.display,
      });

      const config = await context.guildConfigurationService
        .load(execution.guildId)
        .catch(() => null);
      const auditChannelId = config?.settings.auditChannelId ?? null;

      const presentation = await resolveTeamPresentation(interaction, club);
      const thumbnail = getTeamThumbnail(club.emoji);

      const title = `${BOT_EMOJIS.success} Team Added`;
      const description = `Successfully added ${formatTeamIdentity(presentation.team, 'message')}.`;
      const auditFields = [
        { name: 'Role', value: `<@&${club.discordRoleId}>`, inline: true },
        { name: 'Emoji', value: club.emoji, inline: true },
      ];

      const auditPublished = await publishSetupAudit(context, {
        channelId: auditChannelId,
        title,
        description,
        fields: auditFields,
        actorDiscordUserId: execution.authorization.discordUserId,
        actorVerb: 'Added',
      });

      const embed = createSuccessEmbed({
        title,
        description: withAuditWarning(description, auditPublished),
        color: getTeamEmbedColor(presentation, BOT_COLORS.success),
        fields: [
          ...auditFields,
          createActorField('Added', execution.authorization.discordUserId, actorDisplayName),
        ],
        thumbnail,
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'edit') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const teamId = requireString(execution.options, 'team');
      const role = execution.options.getRole('role');
      const rawEmoji = execution.options.getString('emoji');

      let emojiToUpdate: string | undefined = undefined;
      if (rawEmoji !== null && rawEmoji !== undefined) {
        const validatedEmoji = validateTeamEmoji(rawEmoji, guildEmojis);
        emojiToUpdate = validatedEmoji.display;
      }

      const club = await context.clubManagementService.edit({
        authorization: execution.authorization,
        clubId: teamId,
        ...(role === null ? {} : { discordRoleId: role.id }),
        ...(emojiToUpdate === undefined ? {} : { emoji: emojiToUpdate }),
      });

      const config = await context.guildConfigurationService
        .load(execution.guildId)
        .catch(() => null);
      const auditChannelId = config?.settings.auditChannelId ?? null;

      const presentation = await resolveTeamPresentation(interaction, club);
      const thumbnail = getTeamThumbnail(club.emoji);

      const title = `${BOT_EMOJIS.success} Team Updated`;
      const description = `Successfully updated ${formatTeamIdentity(presentation.team, 'message')}.`;
      const auditFields: Array<{ name: string; value: string; inline?: boolean }> = [];
      if (role !== null && role !== undefined) {
        auditFields.push({ name: 'Role', value: `<@&${role.id}>`, inline: true });
      }
      if (emojiToUpdate !== undefined) {
        auditFields.push({ name: 'Emoji', value: emojiToUpdate, inline: true });
      }

      const auditPublished = await publishSetupAudit(context, {
        channelId: auditChannelId,
        title,
        description,
        fields: auditFields,
        actorDiscordUserId: execution.authorization.discordUserId,
        actorVerb: 'Edited',
      });

      const embed = createSuccessEmbed({
        title,
        description: withAuditWarning(description, auditPublished),
        color: getTeamEmbedColor(presentation, BOT_COLORS.success),
        fields: [
          ...auditFields,
          createActorField('Edited', execution.authorization.discordUserId, actorDisplayName),
        ],
        thumbnail,
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // team list is private to the invoking user
    const teams = await context.clubManagementService.listActive(execution.guildId);
    if (teams.length === 0) {
      const embed = createInfoEmbed({
        title: 'Active Teams',
        description: 'No active teams are registered in the league.',
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const teamLines = teams.map(({ club, activePlayerCount, effectiveLimit }) => {
      return `${formatTeamIdentity(club, 'message')} — ${activePlayerCount}/${effectiveLimit}`;
    });

    const embed = createInfoEmbed({
      title: 'Active Teams',
      description: teamLines.join('\n').slice(0, 4000),
    });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
  autocomplete: autocompleteTeam,
};

const limitCommand: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('limit')
    .setDescription('Manage squad limits')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('default')
        .setDescription('Set guild-wide default squad limit')
        .addIntegerOption((option) =>
          option
            .setName('amount')
            .setDescription('Default player limit (1-100)')
            .setMinValue(1)
            .setMaxValue(100)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('team')
        .setDescription('Set squad limit override for a team')
        .addStringOption((option) =>
          option.setName('team').setDescription('Team').setAutocomplete(true).setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName('amount')
            .setDescription('Override player limit (1-100)')
            .setMinValue(1)
            .setMaxValue(100)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('reset')
        .setDescription('Clear squad limit override for a team')
        .addStringOption((option) =>
          option.setName('team').setDescription('Team').setAutocomplete(true).setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('view')
        .setDescription('View squad limits')
        .addStringOption((option) =>
          option.setName('team').setDescription('Optional team').setAutocomplete(true),
        ),
    ),
  async execute(interaction, context) {
    const execution = await enforceChannelPolicy(interaction, context);
    const subcommand = execution.options.getSubcommand();
    const actorDisplayName = getUserDisplayName(interaction, execution.authorization.discordUserId);

    if (subcommand === 'default') {
      const amount = requireInteger(execution.options, 'amount');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await context.limitManagementService.setDefaultLimit({
        authorization: execution.authorization,
        amount,
      });

      const config = await context.guildConfigurationService
        .load(execution.guildId)
        .catch(() => null);
      const auditChannelId = config?.settings.auditChannelId ?? null;

      const title = `${BOT_EMOJIS.success} Squad Limit Updated`;
      const description = `Guild-wide default squad limit set to **${result.defaultSquadLimit}** players.`;
      const auditFields = [
        { name: 'Default Limit', value: `**${result.defaultSquadLimit}** players`, inline: true },
      ];

      const auditPublished = await publishSetupAudit(context, {
        channelId: auditChannelId,
        title,
        description,
        fields: auditFields,
        actorDiscordUserId: execution.authorization.discordUserId,
        actorVerb: 'Updated',
      });

      const embed = createSuccessEmbed({
        title,
        description: withAuditWarning(description, auditPublished),
        fields: [
          ...auditFields,
          createActorField('Updated', execution.authorization.discordUserId, actorDisplayName),
        ],
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'team') {
      const teamId = requireString(execution.options, 'team');
      const amount = requireInteger(execution.options, 'amount');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await context.limitManagementService.setTeamLimit({
        authorization: execution.authorization,
        clubId: teamId,
        amount,
      });

      const config = await context.guildConfigurationService
        .load(execution.guildId)
        .catch(() => null);
      const auditChannelId = config?.settings.auditChannelId ?? null;

      const presentation = await resolveTeamPresentation(interaction, result.club);
      const title = `${BOT_EMOJIS.success} Team Squad Limit Updated`;
      const description = `Updated squad limit for ${formatTeamIdentity(presentation.team, 'message')} to **${result.override}** players.`;
      const auditFields = [
        { name: 'Limit Override', value: `**${result.override}** players`, inline: true },
      ];

      const auditPublished = await publishSetupAudit(context, {
        channelId: auditChannelId,
        title,
        description,
        fields: auditFields,
        actorDiscordUserId: execution.authorization.discordUserId,
        actorVerb: 'Updated',
      });

      const embed = createSuccessEmbed({
        title,
        description: withAuditWarning(description, auditPublished),
        color: getTeamEmbedColor(presentation, BOT_COLORS.success),
        fields: [
          ...auditFields,
          createActorField('Updated', execution.authorization.discordUserId, actorDisplayName),
        ],
        thumbnail: getTeamThumbnail(result.club.emoji),
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'reset') {
      const teamId = requireString(execution.options, 'team');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await context.limitManagementService.resetTeamLimit({
        authorization: execution.authorization,
        clubId: teamId,
      });

      const config = await context.guildConfigurationService
        .load(execution.guildId)
        .catch(() => null);
      const auditChannelId = config?.settings.auditChannelId ?? null;

      const presentation = await resolveTeamPresentation(interaction, result.club);
      const title = `${BOT_EMOJIS.success} Team Squad Limit Reset`;
      const description = `Reset squad limit for ${formatTeamIdentity(presentation.team, 'message')} to the guild default (**${result.effectiveLimit}** players).`;
      const auditFields = [
        {
          name: 'Effective Limit',
          value: `**${result.effectiveLimit}** players (Default)`,
          inline: true,
        },
      ];

      const auditPublished = await publishSetupAudit(context, {
        channelId: auditChannelId,
        title,
        description,
        fields: auditFields,
        actorDiscordUserId: execution.authorization.discordUserId,
        actorVerb: 'Reset',
      });

      const embed = createSuccessEmbed({
        title,
        description: withAuditWarning(description, auditPublished),
        color: getTeamEmbedColor(presentation, BOT_COLORS.success),
        fields: [
          ...auditFields,
          createActorField('Reset', execution.authorization.discordUserId, actorDisplayName),
        ],
        thumbnail: getTeamThumbnail(result.club.emoji),
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // limit view is private to the invoking user
    const teamId = execution.options.getString('team') ?? undefined;
    const view = await context.limitManagementService.viewLimit(execution.guildId, teamId);

    if (view.selectedClub !== undefined) {
      const presentation = await resolveTeamPresentation(interaction, view.selectedClub.club);
      const thumbnail = getTeamThumbnail(view.selectedClub.club.emoji);
      const embed = createInfoEmbed({
        title: 'Squad Limit',
        description: formatTeamIdentity(presentation.team, 'message'),
        color: getTeamEmbedColor(presentation, BOT_COLORS.info),
        fields: [
          { name: 'Guild Default', value: `${view.defaultSquadLimit}`, inline: true },
          {
            name: 'Team Override',
            value: view.selectedClub.override ? `${view.selectedClub.override}` : BOT_LABELS.none,
            inline: true,
          },
          { name: 'Effective Limit', value: `${view.selectedClub.effectiveLimit}`, inline: true },
        ],
        thumbnail,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const overrideLines =
      view.clubsWithOverrides.length === 0
        ? BOT_LABELS.none
        : view.clubsWithOverrides
            .map(({ club, override }) => `- ${formatTeamIdentity(club, 'message')}: ${override}`)
            .join('\n');

    const embed = createInfoEmbed({
      title: 'Squad Limit Configuration',
      fields: [
        { name: 'Guild Default Limit', value: `${view.defaultSquadLimit}`, inline: false },
        { name: 'Team Overrides', value: overrideLines, inline: false },
      ],
    });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
  autocomplete: autocompleteTeam,
};

const staffCommand: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('staff')
    .setDescription('Manage team staff')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('appoint')
        .setDescription('Appoint a staff member')
        .addStringOption((option) =>
          option.setName('team').setDescription('Team').setAutocomplete(true).setRequired(true),
        )
        .addUserOption((option) =>
          option.setName('user').setDescription('Staff member').setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('staff_type')
            .setDescription('Staff position')
            .addChoices(
              { name: BOT_LABELS.teamManager, value: 'TEAM_MANAGER' },
              { name: BOT_LABELS.assistantTeamManager, value: 'ASSISTANT_MANAGER' },
              { name: BOT_LABELS.playerManager, value: 'PLAYER_MANAGER' },
            )
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('Remove the active holder of a staff position')
        .addStringOption((option) =>
          option.setName('team').setDescription('Team').setAutocomplete(true).setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('staff_type')
            .setDescription('Staff position')
            .addChoices(
              { name: BOT_LABELS.teamManager, value: 'TEAM_MANAGER' },
              { name: BOT_LABELS.assistantTeamManager, value: 'ASSISTANT_MANAGER' },
              { name: BOT_LABELS.playerManager, value: 'PLAYER_MANAGER' },
            )
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('List active team staff')
        .addStringOption((option) =>
          option.setName('team').setDescription('Optional team').setAutocomplete(true),
        ),
    ),
  async execute(interaction, context) {
    const execution = await enforceChannelPolicy(interaction, context);
    const subcommand = execution.options.getSubcommand();
    const actorDisplayName = getUserDisplayName(interaction, execution.authorization.discordUserId);

    if (subcommand === 'appoint') {
      const teamId = requireString(execution.options, 'team');
      const user = requireUser(execution.options, 'user');
      const staffType = requireString(execution.options, 'staff_type') as StaffType;
      const targetDisplayName = user.displayName || getUserDisplayName(interaction, user.id);

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await context.staffManagementService.appoint({
        authorization: execution.authorization,
        clubId: teamId,
        staffDiscordUserId: user.id,
        staffIsBot: user.bot,
        staffType,
      });

      const positionName = getFriendlyPositionName(staffType);
      const presentation = await resolveTeamPresentation(interaction, result.club);
      const targetFormatted = formatUserWithVisibleName(
        result.user.discordUserId,
        targetDisplayName,
      );
      const baseDescription = `Successfully appointed ${targetFormatted} as the ${positionName} of ${formatTeamIdentity(presentation.team, 'message')}.`;
      const warning = formatRosterAdminWarning(
        result.announcementDelivered,
        result.auditAnnouncementDelivered,
      );
      const description =
        warning === null ? `${baseDescription}` : `${baseDescription}\n\n${warning}`;
      const embed = createSuccessEmbed({
        title: `${BOT_EMOJIS.success} Staff Member Appointed`,
        description,
        color: getTeamEmbedColor(presentation, BOT_COLORS.success),
        fields: [
          createActorField('Appointed', execution.authorization.discordUserId, actorDisplayName),
        ],
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'remove') {
      const teamId = requireString(execution.options, 'team');
      const staffType = requireString(execution.options, 'staff_type') as StaffType;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await context.staffManagementService.remove(
        execution.authorization,
        teamId,
        staffType,
      );

      const targetDisplayName = getUserDisplayName(interaction, result.user.discordUserId);
      const targetFormatted = formatUserWithVisibleName(
        result.user.discordUserId,
        targetDisplayName,
      );
      const positionName = getFriendlyPositionName(staffType);
      const presentation = await resolveTeamPresentation(interaction, result.club);
      const baseDescription = `Successfully removed ${targetFormatted} as the ${positionName} of ${formatTeamIdentity(presentation.team, 'message')}.`;
      const warning = formatRosterAdminWarning(
        result.announcementDelivered,
        result.auditAnnouncementDelivered,
      );
      const description =
        warning === null ? `${baseDescription}` : `${baseDescription}\n\n${warning}`;
      const embed = createSuccessEmbed({
        title: `${BOT_EMOJIS.success} Staff Member Removed`,
        description,
        color: getTeamEmbedColor(presentation, BOT_COLORS.success),
        fields: [
          createActorField('Removed', execution.authorization.discordUserId, actorDisplayName),
        ],
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // staff list is private to the invoking user
    const selectedTeamId = execution.options.getString('team');
    if (selectedTeamId) {
      const staff = await context.staffManagementService.list(execution.guildId, selectedTeamId);
      const resolvedNames = await resolveUserDisplayNames(
        interaction,
        staff.map(({ user }) => user.discordUserId),
      );
      const activeTeams = (await context.clubManagementService.listActive(execution.guildId)) ?? [];
      const selectedClubItem = activeTeams.find((item) => item.club.id === selectedTeamId);
      const presentation = selectedClubItem
        ? await resolveTeamPresentation(interaction, selectedClubItem.club)
        : null;
      const thumbnail = selectedClubItem ? getTeamThumbnail(selectedClubItem.club.emoji) : null;

      const embed = createInfoEmbed({
        title: 'Team Staff',
        ...(presentation ? { color: getTeamEmbedColor(presentation, BOT_COLORS.info) } : {}),
        ...(selectedClubItem
          ? {
              fields: [
                {
                  name: '\u200b',
                  value: renderTeamStaffBlock(
                    formatTeamIdentity(selectedClubItem.club, 'message'),
                    staff,
                    resolvedNames,
                  ),
                  inline: false,
                },
              ],
            }
          : {}),
        thumbnail,
      });

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const activeTeams = (await context.clubManagementService.listActive(execution.guildId)) ?? [];
    if (activeTeams.length === 0) {
      const embed = createInfoEmbed({
        title: 'Team Staff Directory',
        description: 'No active teams are registered in the league.',
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const teamStaff = await Promise.all(
      activeTeams.map(async ({ club }) => ({
        club,
        staff: await context.staffManagementService.list(execution.guildId, club.id),
      })),
    );
    const resolvedNames = await resolveUserDisplayNames(
      interaction,
      teamStaff.flatMap(({ staff }) => staff.map(({ user }) => user.discordUserId)),
    );
    const fields = teamStaff.map(({ club, staff }) => ({
      name: '\u200b',
      value: renderTeamStaffBlock(formatTeamIdentity(club, 'message'), staff, resolvedNames),
      inline: false,
    }));

    const embeds = chunkStaffDirectoryFields(fields).map((chunk, index) =>
      createInfoEmbed({
        title: index === 0 ? 'League Staff Directory' : 'League Staff Directory Continued',
        fields: chunk,
      }),
    );

    const firstEmbed = embeds[0];
    if (firstEmbed === undefined) throw new ConfigurationError('staff directory is empty');
    await interaction.reply({ embeds: [firstEmbed], flags: MessageFlags.Ephemeral });
    for (const embed of embeds.slice(1)) {
      await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  },
  autocomplete: autocompleteTeam,
};

const rosterCommand: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('roster')
    .setDescription('View and administratively manage team rosters')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('view')
        .setDescription('View an active team roster')
        .addStringOption((option) =>
          option.setName('team').setDescription('Team').setAutocomplete(true).setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Add a free-agent player to an active team')
        .addUserOption((option) =>
          option.setName('player').setDescription('Player to add').setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('team').setDescription('Team').setAutocomplete(true).setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('Remove an ordinary player from their current team')
        .addUserOption((option) =>
          option.setName('player').setDescription('Player to remove').setRequired(true),
        ),
    ),
  async execute(interaction, context) {
    const execution = await enforceChannelPolicy(interaction, context);
    const subcommand = execution.options.getSubcommand();

    if (subcommand === 'add' || subcommand === 'remove') {
      const service = context.rosterAdministrationService;
      if (service === undefined) {
        throw new ConfigurationError('roster administration service is unavailable');
      }
      const selectedPlayer = requireUser(execution.options, 'player');
      const occurredAt = new Date();
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result =
        subcommand === 'add'
          ? await service.add({
              authorization: execution.authorization,
              clubId: requireString(execution.options, 'team'),
              playerDiscordUserId: selectedPlayer.id,
              playerIsBot: selectedPlayer.bot,
              occurredAt,
            })
          : await service.remove({
              authorization: execution.authorization,
              playerDiscordUserId: selectedPlayer.id,
              occurredAt,
            });
      const presentation = await resolveTeamPresentation(interaction, result.club);
      const playerDisplayName =
        selectedPlayer.displayName?.trim() ||
        (await interaction.resolveGuildMemberDisplayName?.(selectedPlayer.id)) ||
        getUserDisplayName(interaction, selectedPlayer.id);
      const player = formatUserWithVisibleName(selectedPlayer.id, playerDisplayName);
      const team = formatTeamIdentity(presentation.team, 'message');
      const actorDisplayName = getUserDisplayName(
        interaction,
        execution.authorization.discordUserId,
      );
      const actorFooter = createActorFooter({
        verb: subcommand === 'add' ? 'Added' : 'Removed',
        username: actorDisplayName,
        timestamp: occurredAt,
      });
      const baseDescription =
        subcommand === 'add'
          ? `${player} has been added to ${team}.`
          : `${player} has been removed from ${team} and is now a free agent.`;
      const warning = formatRosterAdminWarning(
        result.announcementDelivered,
        result.auditAnnouncementDelivered,
      );
      const description =
        warning === null ? `${baseDescription}` : `${baseDescription}\n\n${warning}`;
      const embed = createSuccessEmbed({
        title:
          subcommand === 'add'
            ? `${BOT_EMOJIS.success} Player Added to Roster`
            : `${BOT_EMOJIS.success} Player Removed from Roster`,
        description,
        author: createGuildAuthor({
          guildName: result.guild.name,
          guildIconUrl: interaction.guildIconUrl ?? null,
        }),
        color: getTeamEmbedColor(presentation, BOT_COLORS.success),
        thumbnail: getTeamThumbnail(result.club.emoji),
        footer: actorFooter.text,
        ...(actorFooter.iconURL ? { footerIconURL: actorFooter.iconURL } : {}),
        timestamp: occurredAt,
      });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (subcommand !== 'view') throw new ConfigurationError('unknown roster subcommand');
    const teamId = requireString(execution.options, 'team');

    // roster view is private to the invoking user and matches the visual specification
    const result = await context.rosterManagementService.list(execution.guildId, teamId);
    const settings = await context.guildConfigurationService
      .load(execution.guildId)
      .catch(() => null);

    const effectiveLimit = getEffectiveSquadLimit(result.club, settings?.settings);
    const thumbnail = getTeamThumbnail(result.club.emoji);
    const presentation = await resolveTeamPresentation(interaction, result.club);

    const staffByType = new Map(result.staff.map((m) => [m.membershipType, m.user]));
    const tmUser = staffByType.get('TEAM_MANAGER');
    const atmUser = staffByType.get('ASSISTANT_MANAGER');
    const pmUser = staffByType.get('PLAYER_MANAGER');
    const resolvedNames = await resolveUserDisplayNames(interaction, [
      ...result.staff.map(({ user }) => user.discordUserId),
      ...result.ordinaryPlayers.map(({ user }) => user.discordUserId),
    ]);

    const tmLine = tmUser
      ? formatUserWithVisibleName(
          tmUser.discordUserId,
          resolvedNames.get(tmUser.discordUserId) ?? 'Unknown User',
        )
      : BOT_LABELS.none;
    const atmLine = atmUser
      ? formatUserWithVisibleName(
          atmUser.discordUserId,
          resolvedNames.get(atmUser.discordUserId) ?? 'Unknown User',
        )
      : BOT_LABELS.none;
    const pmLine = pmUser
      ? formatUserWithVisibleName(
          pmUser.discordUserId,
          resolvedNames.get(pmUser.discordUserId) ?? 'Unknown User',
        )
      : BOT_LABELS.none;

    const playerChunks = chunkRosterPlayerLines(
      result.ordinaryPlayers.map(
        ({ user }) =>
          `• ${formatUserWithVisibleName(
            user.discordUserId,
            resolvedNames.get(user.discordUserId) ?? 'Unknown User',
          )}`,
      ),
    );

    const leagueName = settings?.guild?.name ?? execution.guildName;
    const author = createGuildAuthor({
      guildName: leagueName,
      guildIconUrl: interaction.guildIconUrl ?? null,
    });

    const embed = createInfoEmbed({
      author,
      description: `${formatTeamIdentity(presentation.team, 'message')} Roster`,
      color: getTeamEmbedColor(presentation, BOT_COLORS.info),
      fields: [
        {
          name: `${BOT_EMOJIS.roster} ${BOT_LABELS.rosterCount}`,
          value: `${result.allActiveMembers.length}/${effectiveLimit}`,
          inline: false,
        },
        {
          name: `${BOT_EMOJIS.teamManager} ${BOT_LABELS.teamManager}`,
          value: tmLine,
          inline: false,
        },
        {
          name: `${BOT_EMOJIS.assistantTeamManager} ${BOT_LABELS.assistantTeamManager}`,
          value: atmLine,
          inline: false,
        },
        {
          name: `${BOT_EMOJIS.playerManager} ${BOT_LABELS.playerManager}`,
          value: pmLine,
          inline: false,
        },
        { name: `──────── ${BOT_LABELS.players} ────────`, value: '\u200b', inline: false },
        {
          name: `${BOT_EMOJIS.player} ${BOT_LABELS.players}`,
          value: playerChunks[0] ?? BOT_LABELS.none,
          inline: false,
        },
      ],
      thumbnail,
      footer: `Roster for ${formatTeamPlainRoleName(presentation.team)}, ${leagueName}`,
    });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    for (const playerChunk of playerChunks.slice(1)) {
      const continuation = createInfoEmbed({
        author,
        description: `${formatTeamIdentity(presentation.team, 'message')} Roster`,
        color: getTeamEmbedColor(presentation, BOT_COLORS.info),
        fields: [
          {
            name: `${BOT_EMOJIS.player} ${BOT_LABELS.players}`,
            value: playerChunk,
            inline: false,
          },
        ],
        thumbnail,
        footer: `Roster for ${formatTeamPlainRoleName(presentation.team)}, ${leagueName}`,
      });
      await interaction.followUp({ embeds: [continuation], flags: MessageFlags.Ephemeral });
    }
  },
  autocomplete: autocompleteTeam,
};

const teamHealthCommand: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('teamhealth')
    .setDescription('View active team roster health')
    .addStringOption((option) =>
      option
        .setName('team')
        .setDescription('View detailed health for a specific team')
        .setAutocomplete(true),
    ),
  async execute(interaction, context) {
    const execution = await enforceChannelPolicy(interaction, context);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const service = context.teamHealthService;
    if (service === undefined) {
      throw new ConfigurationError('team health service is unavailable');
    }

    const selectedTeamId = execution.options.getString('team');
    const requestedAt = new Date();
    const actorDisplayName = getUserDisplayName(interaction, execution.authorization.discordUserId);
    const footer = createActorFooter({
      verb: 'Requested',
      username: actorDisplayName,
      timestamp: requestedAt,
    });

    if (selectedTeamId !== null) {
      const result = await service.getDetail(execution.guildId, selectedTeamId);
      const presentation = await resolveTeamPresentation(interaction, result.team.club);
      if (presentation.role === null) throw new DiscordRoleMissingError('TEAM');

      const resolvedNames = await resolveUserDisplayNames(
        interaction,
        result.team.staff.map(({ user }) => user.discordUserId),
      );
      const author = createGuildAuthor({
        guildName: result.guild.name || execution.guildName,
        guildIconUrl: interaction.guildIconUrl ?? null,
      });
      const embed = createInfoEmbed({
        author,
        title: 'Team Health',
        description: formatDetailedTeamHealthDescription({
          team: presentation.team,
          activePlayerCount: result.team.activePlayerCount,
          effectiveSquadLimit: result.team.effectiveSquadLimit,
          staff: result.team.staff,
          resolvedNames,
        }),
        color: getTeamEmbedColor(presentation, BOT_COLORS.info),
        thumbnail: getTeamThumbnail(result.team.club.emoji),
        footer: footer.text,
        footerIconURL: footer.iconURL ?? null,
        timestamp: requestedAt,
      });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const result = await service.getOverview(execution.guildId);
    const author = createGuildAuthor({
      guildName: result.guild.name || execution.guildName,
      guildIconUrl: interaction.guildIconUrl ?? null,
    });
    if (result.teams.length === 0) {
      const embed = createInfoEmbed({
        author,
        title: 'Team Health Overview',
        description: 'No active teams are currently configured.',
        footer: footer.text,
        footerIconURL: footer.iconURL ?? null,
        timestamp: requestedAt,
      });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const presentedTeams = await Promise.all(
      result.teams.map(async ({ club, activePlayerCount }) => {
        const presentation = await resolveTeamPresentation(interaction, club);
        if (presentation.role === null) throw new DiscordRoleMissingError('TEAM');
        return { presentation, activePlayerCount };
      }),
    );
    const descriptions = chunkTeamHealthLines(
      presentedTeams.map(({ presentation, activePlayerCount }) =>
        formatCompactTeamHealthLine(presentation.team, activePlayerCount),
      ),
    );
    const embeds = descriptions.map((description, index) =>
      createInfoEmbed({
        author,
        title: index === 0 ? 'Team Health Overview' : 'Team Health Overview Continued',
        description,
        footer: footer.text,
        footerIconURL: footer.iconURL ?? null,
        timestamp: requestedAt,
      }),
    );

    const firstBatch = embeds.slice(0, 10);
    await interaction.editReply({ embeds: firstBatch });
    for (let index = 10; index < embeds.length; index += 10) {
      await interaction.followUp({
        embeds: embeds.slice(index, index + 10),
        flags: MessageFlags.Ephemeral,
      });
    }
  },
  autocomplete: autocompleteTeam,
};

const folistCommand: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('folist')
    .setDescription("List every active team's Team Manager"),
  async execute(interaction, context) {
    const execution = await enforceChannelPolicy(interaction, context);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const service = context.franchiseOwnerListService;
    if (service === undefined) {
      throw new ConfigurationError('franchise owner list service is unavailable');
    }

    const requestedAt = new Date();
    const actorDisplayName = getUserDisplayName(interaction, execution.authorization.discordUserId);
    const footer = createActorFooter({
      verb: 'Requested',
      username: actorDisplayName,
      timestamp: requestedAt,
    });

    const result = await service.getList(execution.guildId);
    const author = createGuildAuthor({
      guildName: result.guild.name || execution.guildName,
      guildIconUrl: interaction.guildIconUrl ?? null,
    });

    if (result.items.length === 0) {
      const embed = createInfoEmbed({
        author,
        title: 'Franchise Owner List',
        description: 'No active teams are currently configured.',
        footer: footer.text,
        footerIconURL: footer.iconURL ?? null,
        timestamp: requestedAt,
      });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const presentedItems = await Promise.all(
      result.items.map(async ({ club, teamManager }) => {
        const presentation = await resolveTeamPresentation(interaction, club);
        if (presentation.role === null) throw new DiscordRoleMissingError('TEAM');
        return { presentation, teamManager };
      }),
    );

    const managerUserIds = presentedItems
      .map(({ teamManager }) => teamManager?.user.discordUserId)
      .filter((id): id is string => id !== undefined && id !== null);

    const resolvedNames = await resolveUserDisplayNames(interaction, managerUserIds);

    const lines = presentedItems.map(({ presentation, teamManager }) => {
      const managerUserId = teamManager?.user.discordUserId ?? null;
      const managerDisplayName =
        managerUserId !== null ? (resolvedNames.get(managerUserId) ?? null) : null;
      return formatFranchiseOwnerListLine(presentation.team, managerUserId, managerDisplayName);
    });

    const descriptions = chunkTeamHealthLines(lines);

    const embeds = descriptions.map((description, index) =>
      createInfoEmbed({
        author,
        title: index === 0 ? 'Franchise Owner List' : 'Franchise Owner List Continued',
        description,
        footer: footer.text,
        footerIconURL: footer.iconURL ?? null,
        timestamp: requestedAt,
      }),
    );

    const firstBatch = embeds.slice(0, 10);
    await interaction.editReply({ embeds: firstBatch });
    for (let index = 10; index < embeds.length; index += 10) {
      await interaction.followUp({
        embeds: embeds.slice(index, index + 10),
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};

const offerCommand: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('offer')
    .setDescription('Send a contract offer to a player')
    .addUserOption((option) =>
      option.setName('player').setDescription('Offered player').setRequired(true),
    ),
  async execute(interaction, context) {
    const execution = await enforceChannelPolicy(interaction, context);
    const player = requireUser(execution.options, 'player');
    const targetDisplayName = player.displayName || getUserDisplayName(interaction, player.id);
    const actorDisplayName = getUserDisplayName(interaction, execution.authorization.discordUserId);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // derive the team from the staff appointment
    const destinationClub = await context.staffManagementService.getCallerActiveStaffClub(
      execution.guildId,
      execution.authorization.discordUserId,
    );
    const sourcePresentation = await resolveTeamPresentation(interaction, destinationClub);

    const result = await context.offerDeliveryService.createAndDeliver(
      {
        authorization: execution.authorization,
        destinationClubId: destinationClub.id,
        playerDiscordUserId: player.id,
        playerIsBot: player.bot,
      },
      {
        sourceTeamRoleColor: sourcePresentation.role?.color ?? null,
        sourceTeamRoleName: sourcePresentation.role?.name ?? null,
        guildName: execution.guildName,
        guildIconUrl: interaction.guildIconUrl ?? null,
        offeredByUsername: actorDisplayName,
      },
    );

    const club = result.destinationClub;
    const presentation = await resolveTeamPresentation(interaction, club ?? destinationClub);
    const thumbnail = getTeamThumbnail(club?.emoji);

    const targetFormatted = formatUserWithVisibleName(player.id, targetDisplayName);
    const actorFormatted = formatUserWithVisibleName(
      execution.authorization.discordUserId,
      actorDisplayName,
    );
    const embed = createSuccessEmbed({
      title: `${BOT_EMOJIS.success} Contract Offer Sent`,
      description: `A private contract offer has been sent to ${targetFormatted} by ${actorFormatted} on behalf of ${formatTeamIdentity(presentation.team, 'message')}.`,
      color: getTeamEmbedColor(presentation, BOT_COLORS.success),
      thumbnail,
    });

    await interaction.editReply({ embeds: [embed] });
  },
};

export const debugResetCommand: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('debugreset')
    .setDescription('Development-only: Reset all SL Bot database data for this server'),
  async execute(interaction, context) {
    await enforceChannelPolicy(interaction, context);
    // run the debug reset safety flow
    if (interaction.executeDebugReset === undefined) {
      throw new ConfigurationError('debug reset interaction support is unavailable');
    }
    await interaction.executeDebugReset(context.database);
  },
};

export const commands: readonly CommandDefinition[] = [
  healthCommand,
  setupCommand,
  teamCommand,
  limitCommand,
  staffCommand,
  rosterCommand,
  teamHealthCommand,
  folistCommand,
  offerCommand,
  demandCommand,
  releaseCommand,
  promoteCommand,
  demoteCommand,
];

export const commandDefinitions = [
  healthCommand,
  setupCommand,
  teamCommand,
  limitCommand,
  staffCommand,
  rosterCommand,
  teamHealthCommand,
  folistCommand,
  offerCommand,
  demandCommand,
  releaseCommand,
  promoteCommand,
  demoteCommand,
  ...(process.env['SLBOT_ENABLE_DEBUG_COMMANDS'] === 'true' ? [debugResetCommand] : []),
] satisfies readonly CommandDefinition[];
