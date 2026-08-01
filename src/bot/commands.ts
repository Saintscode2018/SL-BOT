import { ChannelType, MessageFlags, SlashCommandBuilder } from 'discord.js';

import { ConfigurationError, ValidationError } from '../domain/errors.js';
import { getEffectiveSquadLimit } from '../domain/squad-limit.js';
import type { AuthorizationInput } from '../services/authorization-service.js';
import type { StaffType } from '../services/staff-management-service.js';
import { createInfoEmbed, createSuccessEmbed } from './embeds.js';
import {
  formatTeamNameWithEmoji,
  getTeamThumbnail,
  parseCustomEmoji,
  validateCustomEmoji,
} from './emoji-helper.js';
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
): Promise<void> {
  const { guildId, channelId } = interaction;
  if (guildId !== undefined && channelId !== undefined) {
    const subcommand = interaction.options?.getSubcommand();
    await context.commandChannelPolicyService.validateChannelPolicy({
      discordGuildId: guildId,
      channelId,
      commandName: interaction.commandName,
      subcommand,
      hasAdministratorPermission: interaction.hasAdministratorPermission ?? false,
    });
  }
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

function requiredUser(
  options: CommandInteractionOptions,
  name: string,
): { id: string; bot: boolean } {
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
  if (interaction.guildId === null || interaction.focusedName !== 'team') {
    await interaction.respond([]);
    return;
  }
  await interaction.respond(
    await context.clubManagementService.autocomplete(
      interaction.guildId,
      interaction.focusedValue,
      25,
    ),
  );
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
        { name: 'Bot Status', value: 'Online', inline: true },
        { name: 'Database', value: connected ? 'Connected' : 'Unavailable', inline: true },
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
    await enforceChannelPolicy(interaction, context);
    const execution = requireExecution(interaction);
    const subcommand = execution.options.getSubcommand();

    if (subcommand === 'league') {
      const timeoutMinutes = execution.options.getInteger('offer_timeout_minutes');
      await interaction.deferReply();
      const result = await context.guildSetupService.setupGuildOnly({
        authorization: execution.authorization,
        guildName: execution.guildName,
        ...(timeoutMinutes === null ? {} : { offerTimeoutSeconds: timeoutMinutes * 60 }),
      });
      const embed = createSuccessEmbed({
        title: 'League Settings Updated',
        description: `League configuration ${result.created ? 'initialized' : 'updated'} for **${result.guild.name}**.`,
        fields: [
          {
            name: 'Offer Timeout',
            value: `${Math.round(result.settings.offerTimeoutSeconds / 60)} minutes`,
            inline: true,
          },
          {
            name: 'Configured By',
            value: `<@${execution.authorization.discordUserId}>`,
            inline: true,
          },
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

      await interaction.deferReply();
      await context.guildSetupService.setupChannels({
        authorization: execution.authorization,
        guildName: execution.guildName,
        botCommandsChannelId: botCmds.id,
        staffChannelId: staff.id,
        transferChannelId: transfer.id,
        auditChannelId: audit.id,
      });
      const embed = createSuccessEmbed({
        title: 'System Channels Configured',
        description: 'Successfully updated channel configuration for the league.',
        fields: [
          { name: 'Bot Commands', value: `<#${botCmds.id}>`, inline: true },
          { name: 'Staff', value: `<#${staff.id}>`, inline: true },
          { name: 'Transfers', value: `<#${transfer.id}>`, inline: true },
          { name: 'Audit Logs', value: `<#${audit.id}>`, inline: true },
          {
            name: 'Configured By',
            value: `<@${execution.authorization.discordUserId}>`,
            inline: true,
          },
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

      await interaction.deferReply();
      await context.guildSetupService.setupRoles({
        authorization: execution.authorization,
        guildName: execution.guildName,
        botPermissionsRoleId: botPerms.id,
        teamManagerRoleId: tm.id,
        assistantManagerRoleId: atm.id,
        playerManagerRoleId: pm.id,
      });
      const embed = createSuccessEmbed({
        title: 'League Roles Configured',
        description: 'Successfully updated role configuration for the league.',
        fields: [
          { name: 'Bot Permissions Role', value: `<@&${botPerms.id}>`, inline: true },
          { name: 'Team Manager', value: `<@&${tm.id}>`, inline: true },
          { name: 'Assistant Manager', value: `<@&${atm.id}>`, inline: true },
          { name: 'Player Manager', value: `<@&${pm.id}>`, inline: true },
          {
            name: 'Configured By',
            value: `<@${execution.authorization.discordUserId}>`,
            inline: true,
          },
        ],
      });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'view') {
      await interaction.deferReply();
      const view = await context.guildSetupService.getView(execution.guildId);

      const channelLines = [
        `Bot Commands: ${view.channels.botCommandsChannelId ? `<#${view.channels.botCommandsChannelId}>` : 'Not configured'}`,
        `Staff: ${view.channels.staffChannelId ? `<#${view.channels.staffChannelId}>` : 'Not configured'}`,
        `Transfers: ${view.channels.transferChannelId ? `<#${view.channels.transferChannelId}>` : 'Not configured'}`,
        `Audit: ${view.channels.auditChannelId ? `<#${view.channels.auditChannelId}>` : 'Not configured'}`,
      ].join('\n');

      const roleLines = [
        `Bot Permissions Role: ${view.roles.botPermissionsRoleId ? `<@&${view.roles.botPermissionsRoleId}>` : 'Not configured'}`,
        `Team Manager: ${view.roles.teamManagerRoleId ? `<@&${view.roles.teamManagerRoleId}>` : 'Not configured'}`,
        `Assistant Manager: ${view.roles.assistantManagerRoleId ? `<@&${view.roles.assistantManagerRoleId}>` : 'Not configured'}`,
        `Player Manager: ${view.roles.playerManagerRoleId ? `<@&${view.roles.playerManagerRoleId}>` : 'Not configured'}`,
      ].join('\n');

      const missingText =
        view.missingConfigurations.length === 0
          ? 'None (Complete)'
          : view.missingConfigurations.join(', ');

      const embed = createInfoEmbed({
        title: `League Configuration — ${view.guildName}`,
        fields: [
          { name: 'Channels', value: channelLines, inline: false },
          { name: 'Roles', value: roleLines, inline: false },
          {
            name: 'Settings',
            value: `Default Squad Limit: ${view.defaultSquadLimit}\nOffer Lifetime: ${view.offerTimeoutMinutes} minutes`,
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
        .addStringOption((option) =>
          option.setName('name').setDescription('Team name').setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('short_name').setDescription('Short team name').setRequired(true),
        )
        .addRoleOption((option) =>
          option.setName('role').setDescription('Existing team role').setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('emoji').setDescription('Custom Discord emoji for team branding'),
        )
        .addStringOption((option) =>
          option.setName('logo_url').setDescription('Optional team logo URL'),
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
        .addStringOption((option) => option.setName('name').setDescription('New team name'))
        .addStringOption((option) => option.setName('short_name').setDescription('New short name'))
        .addRoleOption((option) => option.setName('role').setDescription('New team role'))
        .addStringOption((option) =>
          option.setName('emoji').setDescription('New custom Discord emoji for team branding'),
        )
        .addStringOption((option) => option.setName('logo_url').setDescription('New logo URL')),
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
    await enforceChannelPolicy(interaction, context);
    const execution = requireExecution(interaction);
    const subcommand = execution.options.getSubcommand();

    if (subcommand === 'add') {
      await interaction.deferReply();
      const rawEmoji = execution.options.getString('emoji');
      if (rawEmoji) {
        try {
          validateCustomEmoji(rawEmoji);
        } catch {
          throw new ValidationError(
            'emoji must be a valid custom Discord emoji (e.g. <:name:123456789012345678> or <a:name:123456789012345678>)',
          );
        }
      }

      const club = await context.clubManagementService.create({
        authorization: execution.authorization,
        name: requiredString(execution.options, 'name'),
        shortName: requiredString(execution.options, 'short_name'),
        discordRoleId: requiredRole(execution.options, 'role').id,
        logoUrl: execution.options.getString('logo_url'),
        emoji: rawEmoji,
      });

      const thumbnail = getTeamThumbnail(club.emoji, club.logoUrl);
      const embed = createSuccessEmbed({
        title: 'Team Registered',
        description: `Successfully created team ${formatTeamNameWithEmoji(club.name, club.emoji)} (${club.shortName}).`,
        fields: [
          { name: 'Role', value: `<@&${club.discordRoleId}>`, inline: true },
          { name: 'Squad Limit', value: 'Guild Default', inline: true },
          { name: 'Added By', value: `<@${execution.authorization.discordUserId}>`, inline: true },
        ],
        thumbnail,
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'edit') {
      await interaction.deferReply();
      const teamId = requiredString(execution.options, 'team');
      const name = execution.options.getString('name') ?? undefined;
      const shortName = execution.options.getString('short_name') ?? undefined;
      const role = execution.options.getRole('role');
      const logoUrl = execution.options.getString('logo_url');
      const rawEmoji = execution.options.getString('emoji');

      if (rawEmoji !== null && rawEmoji !== undefined) {
        try {
          validateCustomEmoji(rawEmoji);
        } catch {
          throw new ValidationError(
            'emoji must be a valid custom Discord emoji (e.g. <:name:123456789012345678> or <a:name:123456789012345678>)',
          );
        }
      }

      const club = await context.clubManagementService.edit({
        authorization: execution.authorization,
        clubId: teamId,
        ...(name === undefined ? {} : { name }),
        ...(shortName === undefined ? {} : { shortName }),
        ...(role === null ? {} : { discordRoleId: role.id }),
        ...(logoUrl === null ? {} : { logoUrl }),
        ...(rawEmoji === null ? {} : { emoji: rawEmoji }),
      });

      const thumbnail = getTeamThumbnail(club.emoji, club.logoUrl);
      const embed = createSuccessEmbed({
        title: 'Team Updated',
        description: `Successfully updated ${formatTeamNameWithEmoji(club.name, club.emoji)} (${club.shortName}).`,
        fields: [
          { name: 'Role', value: `<@&${club.discordRoleId}>`, inline: true },
          { name: 'Edited By', value: `<@${execution.authorization.discordUserId}>`, inline: true },
        ],
        thumbnail,
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'remove') {
      await interaction.deferReply();
      const teamId = requiredString(execution.options, 'team');
      const club = await context.clubManagementService.deactivate(execution.authorization, teamId);

      const thumbnail = getTeamThumbnail(club.emoji, club.logoUrl);
      const embed = createSuccessEmbed({
        title: 'Team Removed',
        description: `Successfully deactivated ${formatTeamNameWithEmoji(club.name, club.emoji)} (${club.shortName}). The team is now inactive.`,
        fields: [
          { name: 'Status', value: 'Inactive', inline: true },
          {
            name: 'Removed By',
            value: `<@${execution.authorization.discordUserId}>`,
            inline: true,
          },
          {
            name: 'Historical Data',
            value:
              'Historical memberships, staff appointments, offers, transactions, and audit records are preserved.',
            inline: false,
          },
        ],
        thumbnail,
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // team list is PUBLIC embed
    const teams = await context.clubManagementService.listActive(execution.guildId);
    if (teams.length === 0) {
      const embed = createInfoEmbed({
        title: 'Active Teams',
        description: 'No active teams are registered in the league.',
      });
      await interaction.reply({ embeds: [embed] });
      return;
    }

    const teamLines = teams.map(({ club, activePlayerCount, effectiveLimit, remainingSpaces }) => {
      const parsed = parseCustomEmoji(club.emoji);
      const prefix = parsed ? `${parsed.mention} ` : '';
      return `${prefix}**${club.name} (${club.shortName})** <@&${club.discordRoleId}> — ${activePlayerCount}/${effectiveLimit} (${remainingSpaces} spaces remaining)`;
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
    await enforceChannelPolicy(interaction, context);
    const execution = requireExecution(interaction);
    const subcommand = execution.options.getSubcommand();

    if (subcommand === 'default') {
      const amount = requiredInteger(execution.options, 'amount');
      await interaction.deferReply();
      const result = await context.limitManagementService.setDefaultLimit({
        authorization: execution.authorization,
        amount,
      });

      const embed = createSuccessEmbed({
        title: 'Guild Squad Limit Updated',
        description: `Guild-wide default squad limit set to **${result.defaultSquadLimit}** players.`,
        fields: [
          {
            name: 'Updated By',
            value: `<@${execution.authorization.discordUserId}>`,
            inline: true,
          },
        ],
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'team') {
      const teamId = requiredString(execution.options, 'team');
      const amount = requiredInteger(execution.options, 'amount');
      await interaction.deferReply();
      const result = await context.limitManagementService.setTeamLimit({
        authorization: execution.authorization,
        clubId: teamId,
        amount,
      });

      const embed = createSuccessEmbed({
        title: 'Team Squad Limit Updated',
        description: `Squad limit override for **${result.clubName}** set to **${result.override}** (effective limit: **${result.effectiveLimit}**).`,
        fields: [
          {
            name: 'Updated By',
            value: `<@${execution.authorization.discordUserId}>`,
            inline: true,
          },
        ],
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'reset') {
      const teamId = requiredString(execution.options, 'team');
      await interaction.deferReply();
      const result = await context.limitManagementService.resetTeamLimit({
        authorization: execution.authorization,
        clubId: teamId,
      });

      const embed = createSuccessEmbed({
        title: 'Team Squad Limit Reset',
        description: `Squad limit override for **${result.clubName}** cleared (effective limit: **${result.effectiveLimit}**).`,
        fields: [
          { name: 'Reset By', value: `<@${execution.authorization.discordUserId}>`, inline: true },
        ],
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // limit view is PUBLIC embed
    const teamId = execution.options.getString('team') ?? undefined;
    const view = await context.limitManagementService.viewLimit(execution.guildId, teamId);

    if (view.selectedClub !== undefined) {
      const thumbnail = getTeamThumbnail(view.selectedClub.emoji, view.selectedClub.logoUrl);
      const embed = createInfoEmbed({
        title: `Squad Limit — ${view.selectedClub.name} (${view.selectedClub.shortName})`,
        fields: [
          { name: 'Guild Default', value: `${view.defaultSquadLimit}`, inline: true },
          {
            name: 'Team Override',
            value: view.selectedClub.override ? `${view.selectedClub.override}` : 'None',
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
        ? 'None'
        : view.clubsWithOverrides
            .map((c) => {
              const parsed = parseCustomEmoji(c.emoji);
              const prefix = parsed ? `${parsed.mention} ` : '';
              return `- ${prefix}**${c.name} (${c.shortName})**: ${c.override}`;
            })
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
              { name: 'Team Manager', value: 'TEAM_MANAGER' },
              { name: 'Assistant Manager', value: 'ASSISTANT_MANAGER' },
              { name: 'Player Manager', value: 'PLAYER_MANAGER' },
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
              { name: 'Team Manager', value: 'TEAM_MANAGER' },
              { name: 'Assistant Manager', value: 'ASSISTANT_MANAGER' },
              { name: 'Player Manager', value: 'PLAYER_MANAGER' },
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
    await enforceChannelPolicy(interaction, context);
    const execution = requireExecution(interaction);
    const subcommand = execution.options.getSubcommand();

    if (subcommand === 'appoint') {
      const teamId = requiredString(execution.options, 'team');
      const user = requiredUser(execution.options, 'user');
      await interaction.deferReply();
      const result = await context.staffManagementService.appoint({
        authorization: execution.authorization,
        clubId: teamId,
        staffDiscordUserId: user.id,
        staffIsBot: user.bot,
        staffType: requiredString(execution.options, 'staff_type') as StaffType,
      });

      const embed = createSuccessEmbed({
        title: 'Staff Appointed',
        description: `Successfully appointed <@${result.user.discordUserId}> as **${result.membership.membershipType.replaceAll('_', ' ')}**.`,
        fields: [
          {
            name: 'Appointed By',
            value: `<@${execution.authorization.discordUserId}>`,
            inline: true,
          },
        ],
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'remove') {
      const teamId = requiredString(execution.options, 'team');
      await interaction.deferReply();
      const membership = await context.staffManagementService.remove(
        execution.authorization,
        teamId,
        requiredString(execution.options, 'staff_type') as StaffType,
      );

      const embed = createSuccessEmbed({
        title: 'Staff Removed',
        description: `Successfully removed active **${membership.membershipType.replaceAll('_', ' ')}** position.`,
        fields: [
          {
            name: 'Removed By',
            value: `<@${execution.authorization.discordUserId}>`,
            inline: true,
          },
        ],
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // staff list is PUBLIC embed
    const selectedTeamId = execution.options.getString('team');
    if (selectedTeamId) {
      const staff = await context.staffManagementService.list(execution.guildId, selectedTeamId);
      const activeTeams = await context.clubManagementService.listActive(execution.guildId);
      const selectedClubItem = activeTeams.find((item) => item.club.id === selectedTeamId);
      const thumbnail = selectedClubItem
        ? getTeamThumbnail(selectedClubItem.club.emoji, selectedClubItem.club.logoUrl)
        : null;

      const byType = new Map(
        staff.map((membership) => [membership.membershipType, membership.user]),
      );
      const fields = (['TEAM_MANAGER', 'ASSISTANT_MANAGER', 'PLAYER_MANAGER'] as const).map(
        (type) => ({
          name: type.replaceAll('_', ' '),
          value: byType.has(type) ? `<@${byType.get(type)?.discordUserId}>` : 'Vacant',
          inline: true,
        }),
      );

      const title = selectedClubItem ? `Team Staff — ${selectedClubItem.club.name}` : 'Team Staff';

      const embed = createInfoEmbed({
        title,
        fields,
        thumbnail,
      });

      await interaction.reply({ embeds: [embed] });
      return;
    }

    const activeTeams = await context.clubManagementService.listActive(execution.guildId);
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
        const byType = new Map(staff.map((m) => [m.membershipType, m.user]));
        const staffText = (['TEAM_MANAGER', 'ASSISTANT_MANAGER', 'PLAYER_MANAGER'] as const)
          .map(
            (t) =>
              `**${t.replaceAll('_', ' ')}**: ${byType.has(t) ? `<@${byType.get(t)?.discordUserId}>` : 'Vacant'}`,
          )
          .join(' | ');

        const nameWithEmoji = formatTeamNameWithEmoji(club.name, club.emoji);
        return {
          name: `${nameWithEmoji} (${club.shortName})`,
          value: staffText,
          inline: false,
        };
      }),
    );

    const embed = createInfoEmbed({
      title: 'League Staff Directory',
      fields: fields.slice(0, 25),
    });

    await interaction.reply({ embeds: [embed] });
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
    await enforceChannelPolicy(interaction, context);
    const execution = requireExecution(interaction);
    const teamId = requiredString(execution.options, 'team');

    // roster view is PUBLIC embed
    const result = await context.rosterManagementService.list(execution.guildId, teamId);
    const settings = await context.guildConfigurationService
      .load(execution.guildId)
      .catch(() => null);

    const effectiveLimit = getEffectiveSquadLimit(result.club, settings?.settings);
    const remainingSpaces = Math.max(0, effectiveLimit - result.players.length);
    const thumbnail = getTeamThumbnail(result.club.emoji, result.club.logoUrl);

    const playerList =
      result.players.length === 0
        ? 'No active players on the roster.'
        : result.players.map(({ user }, idx) => `${idx + 1}. <@${user.discordUserId}>`).join('\n');

    const embed = createInfoEmbed({
      title: `Team Roster — ${result.club.name} (${result.club.shortName})`,
      description: playerList.slice(0, 3800),
      fields: [
        {
          name: 'Active Squad Size',
          value: `${result.players.length}/${effectiveLimit}`,
          inline: true,
        },
        { name: 'Remaining Spaces', value: `${remainingSpaces}`, inline: true },
      ],
      thumbnail,
    });

    await interaction.reply({ embeds: [embed] });
  },
  autocomplete: autocompleteTeam,
};

const offerCommand: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('offer')
    .setDescription('Create player offers')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('create')
        .setDescription('Send a private contract offer to a player')
        .addStringOption((option) =>
          option
            .setName('team')
            .setDescription('Destination team')
            .setAutocomplete(true)
            .setRequired(true),
        )
        .addUserOption((option) =>
          option.setName('player').setDescription('Offered player').setRequired(true),
        ),
    ),
  async execute(interaction, context) {
    await enforceChannelPolicy(interaction, context);
    const execution = requireExecution(interaction);
    const player = requiredUser(execution.options, 'player');
    const destinationClubId = requiredString(execution.options, 'team');

    await interaction.deferReply();
    const result = await context.offerDeliveryService.createAndDeliver({
      authorization: execution.authorization,
      destinationClubId,
      playerDiscordUserId: player.id,
      playerIsBot: player.bot,
    });

    const club = result.destinationClub;
    const thumbnail = getTeamThumbnail(club?.emoji, club?.logoUrl);
    const embed = createSuccessEmbed({
      title: 'Contract Offer Sent',
      description: `A private contract offer has been sent to <@${result.player.discordUserId}> on behalf of **${club?.name ?? 'the destination team'}**.`,
      fields: [
        { name: 'Target Player', value: `<@${result.player.discordUserId}>`, inline: true },
        {
          name: 'Destination Team',
          value: `${formatTeamNameWithEmoji(club?.name ?? 'Team', club?.emoji)}`,
          inline: true,
        },
      ],
      thumbnail,
    });

    await interaction.editReply({ embeds: [embed] });
  },
  autocomplete: autocompleteTeam,
};

export const commandDefinitions = [
  healthCommand,
  setupCommand,
  teamCommand,
  limitCommand,
  staffCommand,
  rosterCommand,
  offerCommand,
] satisfies readonly CommandDefinition[];
