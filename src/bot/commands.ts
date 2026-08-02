import { ChannelType, MessageFlags, SlashCommandBuilder } from 'discord.js';

import { ConfigurationError, ValidationError } from '../domain/errors.js';
import { getEffectiveSquadLimit } from '../domain/squad-limit.js';
import { formatTeamIdentity } from '../domain/team-label.js';
import type { AuthorizationInput } from '../services/authorization-service.js';
import { getFriendlyPositionName, type StaffType } from '../services/staff-management-service.js';
import { createActorField, createInfoEmbed, createSuccessEmbed } from './embeds.js';
import { getTeamThumbnail, validateTeamEmoji } from './emoji-helper.js';
import {
  BOT_COLORS,
  BOT_EMOJIS,
  BOT_LABELS,
  createGuildAuthor,
  formatTeamFooterIdentity,
  formatUserWithVisibleName,
  getUserDisplayName,
} from './presentation/index.js';
import { getTeamEmbedColor, resolveTeamPresentation } from './team-presentation.js';
import type {
  CommandAutocompleteInteraction,
  CommandContext,
  CommandDefinition,
  CommandInteraction,
  CommandInteractionOptions,
} from './types.js';

function requireExecution(interaction: CommandInteraction): {
  guildId: string;
  guildName: string;
  options: CommandInteractionOptions;
  authorization: AuthorizationInput;
} {
  const { guildId, guildName, guildOwnerId, userId, options } = interaction;
  if (
    guildId === undefined ||
    guildName === undefined ||
    guildOwnerId === undefined ||
    userId === undefined ||
    options === undefined
  ) {
    throw new ConfigurationError('this command must be used in a Discord server');
  }
  return {
    guildId,
    guildName,
    options,
    authorization: {
      discordGuildId: guildId,
      discordUserId: userId,
      guildOwnerId,
      memberRoleIds: interaction.memberRoleIds ?? [],
      hasAdministratorPermission: interaction.hasAdministratorPermission ?? false,
    },
  };
}

async function enforceChannelPolicy(
  interaction: CommandInteraction,
  context: CommandContext,
): Promise<ReturnType<typeof requireExecution>> {
  const execution = requireExecution(interaction);
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
  });
}

function withAuditWarning(description: string, auditPublished: boolean): string {
  return auditPublished ? description : `${description}\n\n${auditDeliveryWarning}`;
}

function requiredString(options: CommandInteractionOptions, name: string): string {
  const value = options.getString(name);
  if (value === null) throw new ConfigurationError(`${name} is required`);
  return value;
}

function requiredInteger(options: CommandInteractionOptions, name: string): number {
  const value = options.getInteger(name);
  if (value === null) throw new ConfigurationError(`${name} is required`);
  return value;
}

const staffPositions = [
  { type: 'TEAM_MANAGER', emoji: BOT_EMOJIS.teamManager, name: BOT_LABELS.teamManager },
  {
    type: 'ASSISTANT_MANAGER',
    emoji: BOT_EMOJIS.assistantTeamManager,
    name: BOT_LABELS.assistantTeamManager,
  },
  { type: 'PLAYER_MANAGER', emoji: BOT_EMOJIS.playerManager, name: BOT_LABELS.playerManager },
] as const;

function staffDirectoryBlock(
  staff: ReadonlyArray<{ membershipType: string; user: { discordUserId: string } }>,
  interaction?: CommandInteraction,
): string {
  const byType = new Map(staff.map((membership) => [membership.membershipType, membership.user]));
  return staffPositions
    .map(({ type, emoji, name }) => {
      const user = byType.get(type);
      const userFormatted = user
        ? formatUserWithVisibleName(
            user.discordUserId,
            interaction ? getUserDisplayName(interaction, user.discordUserId) : 'Unknown User',
          )
        : BOT_LABELS.vacant;
      return `${emoji} ${name}: ${userFormatted}`;
    })
    .join('\n');
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

function requiredUser(
  options: CommandInteractionOptions,
  name: string,
): { id: string; bot: boolean; displayName?: string } {
  const value = options.getUser(name);
  if (value === null) throw new ConfigurationError(`${name} is required`);
  return value;
}

function requiredRole(options: CommandInteractionOptions, name: string): { id: string } {
  const value = options.getRole(name);
  if (value === null) throw new ConfigurationError(`${name} is required`);
  return value;
}

function requiredChannel(
  options: CommandInteractionOptions,
  name: string,
): { id: string; type: number } {
  const value = options.getChannel(name);
  if (value === null) throw new ConfigurationError(`${name} is required`);
  return value;
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
      const botCmds = requiredChannel(execution.options, 'bot_commands');
      const staff = requiredChannel(execution.options, 'staff');
      const transfer = requiredChannel(execution.options, 'transfer');
      const audit = requiredChannel(execution.options, 'audit');

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
      const botPerms = requiredRole(execution.options, 'bot_permissions');
      const tm = requiredRole(execution.options, 'team_manager');
      const atm = requiredRole(execution.options, 'assistant_manager');
      const pm = requiredRole(execution.options, 'player_manager');

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
        .setName('remove')
        .setDescription('Deactivate an active team while preserving historical records')
        .addStringOption((option) =>
          option
            .setName('team')
            .setDescription('Team to remove')
            .setAutocomplete(true)
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) => subcommand.setName('list').setDescription('List active teams')),
  async execute(interaction, context) {
    const execution = await enforceChannelPolicy(interaction, context);
    const subcommand = execution.options.getSubcommand();
    const guildEmojis = interaction.getGuildEmojis?.() ?? [];
    const actorDisplayName = getUserDisplayName(interaction, execution.authorization.discordUserId);

    if (subcommand === 'add') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const rawEmoji = requiredString(execution.options, 'emoji');
      const validatedEmoji = validateTeamEmoji(rawEmoji, guildEmojis);
      const role = requiredRole(execution.options, 'role');

      const club = await context.clubManagementService.create({
        authorization: execution.authorization,
        discordRoleId: role.id,
        emoji: validatedEmoji.display,
      });

      const presentation = resolveTeamPresentation(interaction, club);
      const thumbnail = getTeamThumbnail(club.emoji);
      const embed = createSuccessEmbed({
        title: `${BOT_EMOJIS.success} Team Added`,
        description: `Successfully added ${formatTeamIdentity(presentation.team, 'message')}.`,
        color: getTeamEmbedColor(presentation, BOT_COLORS.success),
        fields: [
          { name: 'Role', value: `<@&${club.discordRoleId}>`, inline: true },
          { name: 'Emoji', value: club.emoji, inline: true },
          createActorField('Added', execution.authorization.discordUserId, actorDisplayName),
        ],
        thumbnail,
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'edit') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const teamId = requiredString(execution.options, 'team');
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

      const presentation = resolveTeamPresentation(interaction, club);
      const thumbnail = getTeamThumbnail(club.emoji);
      const embed = createSuccessEmbed({
        title: `${BOT_EMOJIS.success} Team Updated`,
        description: `Successfully updated ${formatTeamIdentity(presentation.team, 'message')}.`,
        color: getTeamEmbedColor(presentation, BOT_COLORS.success),
        fields: [
          createActorField('Edited', execution.authorization.discordUserId, actorDisplayName),
        ],
        thumbnail,
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'remove') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const teamId = requiredString(execution.options, 'team');
      const club = await context.clubManagementService.deactivate(execution.authorization, teamId);

      const presentation = resolveTeamPresentation(interaction, club);
      const thumbnail = getTeamThumbnail(club.emoji);
      const embed = createSuccessEmbed({
        title: `${BOT_EMOJIS.success} Team Removed`,
        description: `Successfully deactivated ${formatTeamIdentity(presentation.team, 'message')}. The team is now inactive.`,
        color: getTeamEmbedColor(presentation, BOT_COLORS.success),
        fields: [
          { name: 'Status', value: 'Inactive', inline: true },
          {
            name: 'Historical Data',
            value:
              'Historical memberships, staff appointments, offers, transactions, and audit records are preserved.',
            inline: false,
          },
          createActorField('Removed', execution.authorization.discordUserId, actorDisplayName),
        ],
        thumbnail,
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // team list is public
    const teams = await context.clubManagementService.listActive(execution.guildId);
    if (teams.length === 0) {
      const embed = createInfoEmbed({
        title: 'Active Teams',
        description: 'No active teams are registered in the league.',
      });
      await interaction.reply({ embeds: [embed] });
      return;
    }

    const teamLines = teams.map(({ club, activePlayerCount, effectiveLimit }) => {
      return `${formatTeamIdentity(club, 'message')} — ${activePlayerCount}/${effectiveLimit}`;
    });

    const embed = createInfoEmbed({
      title: 'Active Teams',
      description: teamLines.join('\n').slice(0, 4000),
    });

    await interaction.reply({ embeds: [embed] });
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
      const amount = requiredInteger(execution.options, 'amount');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await context.limitManagementService.setDefaultLimit({
        authorization: execution.authorization,
        amount,
      });

      const embed = createSuccessEmbed({
        title: `${BOT_EMOJIS.success} Squad Limit Updated`,
        description: `Guild-wide default squad limit set to **${result.defaultSquadLimit}** players.`,
        fields: [
          createActorField('Updated', execution.authorization.discordUserId, actorDisplayName),
        ],
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'team') {
      const teamId = requiredString(execution.options, 'team');
      const amount = requiredInteger(execution.options, 'amount');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await context.limitManagementService.setTeamLimit({
        authorization: execution.authorization,
        clubId: teamId,
        amount,
      });

      const presentation = resolveTeamPresentation(interaction, result.club);
      const embed = createSuccessEmbed({
        title: `${BOT_EMOJIS.success} Team Squad Limit Updated`,
        description: `Updated squad limit for ${formatTeamIdentity(presentation.team, 'message')} to **${result.override}** players.`,
        color: getTeamEmbedColor(presentation, BOT_COLORS.success),
        fields: [
          createActorField('Updated', execution.authorization.discordUserId, actorDisplayName),
        ],
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'reset') {
      const teamId = requiredString(execution.options, 'team');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await context.limitManagementService.resetTeamLimit({
        authorization: execution.authorization,
        clubId: teamId,
      });

      const presentation = resolveTeamPresentation(interaction, result.club);
      const embed = createSuccessEmbed({
        title: `${BOT_EMOJIS.success} Team Squad Limit Reset`,
        description: `Reset squad limit for ${formatTeamIdentity(presentation.team, 'message')} to the guild default (**${result.effectiveLimit}** players).`,
        color: getTeamEmbedColor(presentation, BOT_COLORS.success),
        fields: [
          createActorField('Reset', execution.authorization.discordUserId, actorDisplayName),
        ],
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // limit view is public
    const teamId = execution.options.getString('team') ?? undefined;
    const view = await context.limitManagementService.viewLimit(execution.guildId, teamId);

    if (view.selectedClub !== undefined) {
      const presentation = resolveTeamPresentation(interaction, view.selectedClub.club);
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
      await interaction.reply({ embeds: [embed] });
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

    await interaction.reply({ embeds: [embed] });
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
      const teamId = requiredString(execution.options, 'team');
      const user = requiredUser(execution.options, 'user');
      const staffType = requiredString(execution.options, 'staff_type') as StaffType;
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
      const presentation = resolveTeamPresentation(interaction, result.club);
      const targetFormatted = formatUserWithVisibleName(
        result.user.discordUserId,
        targetDisplayName,
      );
      const embed = createSuccessEmbed({
        title: `${BOT_EMOJIS.success} Staff Member Appointed`,
        description: `Successfully appointed ${targetFormatted} as the ${positionName} of ${formatTeamIdentity(presentation.team, 'message')}.`,
        color: getTeamEmbedColor(presentation, BOT_COLORS.success),
        fields: [
          createActorField('Appointed', execution.authorization.discordUserId, actorDisplayName),
        ],
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'remove') {
      const teamId = requiredString(execution.options, 'team');
      const staffType = requiredString(execution.options, 'staff_type') as StaffType;
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
      const presentation = resolveTeamPresentation(interaction, result.club);
      const embed = createSuccessEmbed({
        title: `${BOT_EMOJIS.success} Staff Member Removed`,
        description: `Successfully removed ${targetFormatted} as the ${positionName} of ${formatTeamIdentity(presentation.team, 'message')}.`,
        color: getTeamEmbedColor(presentation, BOT_COLORS.success),
        fields: [
          createActorField('Removed', execution.authorization.discordUserId, actorDisplayName),
        ],
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // staff list is public
    const selectedTeamId = execution.options.getString('team');
    if (selectedTeamId) {
      const staff = await context.staffManagementService.list(execution.guildId, selectedTeamId);
      const activeTeams = (await context.clubManagementService.listActive(execution.guildId)) ?? [];
      const selectedClubItem = activeTeams.find((item) => item.club.id === selectedTeamId);
      const presentation = selectedClubItem
        ? resolveTeamPresentation(interaction, selectedClubItem.club)
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
                  value: `${formatTeamIdentity(selectedClubItem.club, 'message')}\n\n${staffDirectoryBlock(staff, interaction)}`,
                  inline: false,
                },
              ],
            }
          : {}),
        thumbnail,
      });

      await interaction.reply({ embeds: [embed] });
      return;
    }

    const activeTeams = (await context.clubManagementService.listActive(execution.guildId)) ?? [];
    if (activeTeams.length === 0) {
      const embed = createInfoEmbed({
        title: 'Team Staff Directory',
        description: 'No active teams are registered in the league.',
      });
      await interaction.reply({ embeds: [embed] });
      return;
    }

    const fields = await Promise.all(
      activeTeams.map(async ({ club }) => {
        const staff = await context.staffManagementService.list(execution.guildId, club.id);
        return {
          name: '\u200b',
          value: `${formatTeamIdentity(club, 'message')}\n\n${staffDirectoryBlock(staff, interaction)}`,
          inline: false,
        };
      }),
    );

    const embeds = chunkStaffDirectoryFields(fields).map((chunk, index) =>
      createInfoEmbed({
        title: index === 0 ? 'League Staff Directory' : 'League Staff Directory Continued',
        fields: chunk,
      }),
    );

    const firstEmbed = embeds[0];
    if (firstEmbed === undefined) throw new ConfigurationError('staff directory is empty');
    await interaction.reply({ embeds: [firstEmbed] });
    for (const embed of embeds.slice(1)) {
      await interaction.followUp({ embeds: [embed] });
    }
  },
  autocomplete: autocompleteTeam,
};

const rosterCommand: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('roster')
    .setDescription('View team rosters')
    .addStringOption((option) =>
      option.setName('team').setDescription('Team').setAutocomplete(true).setRequired(true),
    ),
  async execute(interaction, context) {
    const execution = await enforceChannelPolicy(interaction, context);
    const teamId = requiredString(execution.options, 'team');

    // roster view matches the visual specification
    const result = await context.rosterManagementService.list(execution.guildId, teamId);
    const settings = await context.guildConfigurationService
      .load(execution.guildId)
      .catch(() => null);

    const effectiveLimit = getEffectiveSquadLimit(result.club, settings?.settings);
    const thumbnail = getTeamThumbnail(result.club.emoji);
    const presentation = resolveTeamPresentation(interaction, result.club);

    const staffByType = new Map(result.staff.map((m) => [m.membershipType, m.user]));
    const tmUser = staffByType.get('TEAM_MANAGER');
    const atmUser = staffByType.get('ASSISTANT_MANAGER');
    const pmUser = staffByType.get('PLAYER_MANAGER');

    const tmLine = tmUser
      ? formatUserWithVisibleName(
          tmUser.discordUserId,
          getUserDisplayName(interaction, tmUser.discordUserId),
        )
      : BOT_LABELS.none;
    const atmLine = atmUser
      ? formatUserWithVisibleName(
          atmUser.discordUserId,
          getUserDisplayName(interaction, atmUser.discordUserId),
        )
      : BOT_LABELS.none;
    const pmLine = pmUser
      ? formatUserWithVisibleName(
          pmUser.discordUserId,
          getUserDisplayName(interaction, pmUser.discordUserId),
        )
      : BOT_LABELS.none;

    const playerLines =
      result.ordinaryPlayers.length === 0
        ? BOT_LABELS.none
        : result.ordinaryPlayers
            .map(
              ({ user }) =>
                `• ${formatUserWithVisibleName(
                  user.discordUserId,
                  getUserDisplayName(interaction, user.discordUserId),
                )}`,
            )
            .join('\n');

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
          value: playerLines.slice(0, 1024),
          inline: false,
        },
      ],
      thumbnail,
      footer: `Roster for ${formatTeamFooterIdentity(presentation.team)}, ${leagueName}`,
    });

    await interaction.reply({ embeds: [embed] });
  },
  autocomplete: autocompleteTeam,
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
    const player = requiredUser(execution.options, 'player');
    const targetDisplayName = player.displayName || getUserDisplayName(interaction, player.id);
    const actorDisplayName = getUserDisplayName(interaction, execution.authorization.discordUserId);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // derive the team from the staff appointment
    const destinationClub = await context.staffManagementService.getCallerActiveStaffClub(
      execution.guildId,
      execution.authorization.discordUserId,
    );
    const sourcePresentation = resolveTeamPresentation(interaction, destinationClub);

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
    const presentation = resolveTeamPresentation(interaction, club ?? destinationClub);
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
  offerCommand,
];

export const commandDefinitions = [
  healthCommand,
  setupCommand,
  teamCommand,
  limitCommand,
  staffCommand,
  rosterCommand,
  offerCommand,
  ...(process.env['SLBOT_ENABLE_DEBUG_COMMANDS'] === 'true' ? [debugResetCommand] : []),
] satisfies readonly CommandDefinition[];
