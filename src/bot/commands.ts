import { ChannelType, MessageFlags, SlashCommandBuilder } from 'discord.js';

import { ConfigurationError, ValidationError } from '../domain/errors.js';
import { getEffectiveSquadLimit } from '../domain/squad-limit.js';
import type { AuthorizationInput } from '../services/authorization-service.js';
import type { StaffType } from '../services/staff-management-service.js';
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
    await interaction.reply({
      content: `SL Bot is online.\nDatabase: ${connected ? 'connected' : 'unavailable'}`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

const setupCommand: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure SL Bot for this server')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('guild')
        .setDescription('Create or update server settings')
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
        .setDescription('Configure league administration roles')
        .addRoleOption((option) =>
          option
            .setName('league_admin')
            .setDescription('League administrator role')
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
      subcommand.setName('view').setDescription('View current server configuration'),
    ),
  async execute(interaction, context) {
    await enforceChannelPolicy(interaction, context);
    const execution = requireExecution(interaction);
    const subcommand = execution.options.getSubcommand();

    if (subcommand === 'guild') {
      const timeoutMinutes = execution.options.getInteger('offer_timeout_minutes');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await context.guildSetupService.setupGuildOnly({
        authorization: execution.authorization,
        guildName: execution.guildName,
        ...(timeoutMinutes === null ? {} : { offerTimeoutSeconds: timeoutMinutes * 60 }),
      });
      await interaction.editReply({
        content: `Guild configuration ${result.created ? 'initialized' : 'updated'} for ${result.guild.name}.`,
      });
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
      await context.guildSetupService.setupChannels({
        authorization: execution.authorization,
        guildName: execution.guildName,
        botCommandsChannelId: botCmds.id,
        staffChannelId: staff.id,
        transferChannelId: transfer.id,
        auditChannelId: audit.id,
      });
      await interaction.editReply({
        content: `Configured system channels:\nBot Commands: <#${botCmds.id}>\nStaff: <#${staff.id}>\nTransfers: <#${transfer.id}>\nAudit: <#${audit.id}>`,
      });
      return;
    }

    if (subcommand === 'roles') {
      const admin = requiredRole(execution.options, 'league_admin');
      const tm = requiredRole(execution.options, 'team_manager');
      const atm = requiredRole(execution.options, 'assistant_manager');
      const pm = requiredRole(execution.options, 'player_manager');

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await context.guildSetupService.setupRoles({
        authorization: execution.authorization,
        guildName: execution.guildName,
        adminRoleId: admin.id,
        teamManagerRoleId: tm.id,
        assistantManagerRoleId: atm.id,
        playerManagerRoleId: pm.id,
      });
      await interaction.editReply({
        content: `Configured league roles:\nLeague Admin: <@&${admin.id}>\nTeam Manager: <@&${tm.id}>\nAssistant Manager: <@&${atm.id}>\nPlayer Manager: <@&${pm.id}>`,
      });
      return;
    }

    if (subcommand === 'view') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const view = await context.guildSetupService.getView(execution.guildId);

      const channelLines = [
        `Bot Commands: ${view.channels.botCommandsChannelId ? `<#${view.channels.botCommandsChannelId}>` : 'Not configured'}`,
        `Staff: ${view.channels.staffChannelId ? `<#${view.channels.staffChannelId}>` : 'Not configured'}`,
        `Transfers: ${view.channels.transferChannelId ? `<#${view.channels.transferChannelId}>` : 'Not configured'}`,
        `Audit: ${view.channels.auditChannelId ? `<#${view.channels.auditChannelId}>` : 'Not configured'}`,
      ].join('\n');

      const roleLines = [
        `League Admin: ${view.roles.adminRoleId ? `<@&${view.roles.adminRoleId}>` : 'Not configured'}`,
        `Team Manager: ${view.roles.teamManagerRoleId ? `<@&${view.roles.teamManagerRoleId}>` : 'Not configured'}`,
        `Assistant Manager: ${view.roles.assistantManagerRoleId ? `<@&${view.roles.assistantManagerRoleId}>` : 'Not configured'}`,
        `Player Manager: ${view.roles.playerManagerRoleId ? `<@&${view.roles.playerManagerRoleId}>` : 'Not configured'}`,
      ].join('\n');

      const missingText =
        view.missingConfigurations.length === 0
          ? 'None (Complete)'
          : view.missingConfigurations.join(', ');

      const content = [
        `**SL Bot Configuration — ${view.guildName}**`,
        `__Channels__:\n${channelLines}`,
        `__Roles__:\n${roleLines}`,
        `__Settings__:\nDefault Squad Limit: ${view.defaultSquadLimit}\nOffer Lifetime: ${view.offerTimeoutMinutes} minutes`,
        `__Missing Configuration__: ${missingText}`,
      ].join('\n\n');

      await interaction.editReply({ content });
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
          option.setName('logo_url').setDescription('Optional team logo URL'),
        )
        .addStringOption((option) => option.setName('emoji').setDescription('Optional team emoji')),
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
        .addStringOption((option) => option.setName('logo_url').setDescription('New logo URL'))
        .addStringOption((option) => option.setName('emoji').setDescription('New team emoji')),
    )
    .addSubcommand((subcommand) => subcommand.setName('list').setDescription('List active teams')),
  async execute(interaction, context) {
    await enforceChannelPolicy(interaction, context);
    const execution = requireExecution(interaction);
    const subcommand = execution.options.getSubcommand();

    if (subcommand === 'add') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const club = await context.clubManagementService.create({
        authorization: execution.authorization,
        name: requiredString(execution.options, 'name'),
        shortName: requiredString(execution.options, 'short_name'),
        discordRoleId: requiredRole(execution.options, 'role').id,
        logoUrl: execution.options.getString('logo_url'),
        emoji: execution.options.getString('emoji'),
      });
      await interaction.editReply({
        content: `Created ${club.name} (${club.shortName}) linked to <@&${club.discordRoleId}>. Limit inherited from guild default.`,
      });
      return;
    }

    if (subcommand === 'edit') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const teamId = requiredString(execution.options, 'team');
      const name = execution.options.getString('name') ?? undefined;
      const shortName = execution.options.getString('short_name') ?? undefined;
      const role = execution.options.getRole('role');
      const logoUrl = execution.options.getString('logo_url');
      const emoji = execution.options.getString('emoji');

      const club = await context.clubManagementService.edit({
        authorization: execution.authorization,
        clubId: teamId,
        ...(name === undefined ? {} : { name }),
        ...(shortName === undefined ? {} : { shortName }),
        ...(role === null ? {} : { discordRoleId: role.id }),
        ...(logoUrl === null ? {} : { logoUrl }),
        ...(emoji === null ? {} : { emoji }),
      });
      await interaction.editReply({
        content: `Updated ${club.name} (${club.shortName}).`,
      });
      return;
    }

    // team list is PUBLIC in bot-commands channel
    const teams = await context.clubManagementService.listActive(execution.guildId);
    const content =
      teams.length === 0
        ? 'No active teams are registered.'
        : teams
            .map(
              ({ club, activePlayerCount, effectiveLimit, remainingSpaces }) =>
                `**${club.name} (${club.shortName})** <@&${club.discordRoleId}> — ${activePlayerCount}/${effectiveLimit} (${remainingSpaces} spaces remaining)`,
            )
            .join('\n')
            .slice(0, 1900);
    await interaction.reply({ content });
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
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await context.limitManagementService.setDefaultLimit({
        authorization: execution.authorization,
        amount,
      });
      await interaction.editReply({
        content: `Guild-wide default squad limit set to ${result.defaultSquadLimit}.`,
      });
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
      await interaction.editReply({
        content: `Squad limit override for ${result.clubName} set to ${result.override} (effective limit: ${result.effectiveLimit}).`,
      });
      return;
    }

    if (subcommand === 'reset') {
      const teamId = requiredString(execution.options, 'team');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await context.limitManagementService.resetTeamLimit({
        authorization: execution.authorization,
        clubId: teamId,
      });
      await interaction.editReply({
        content: `Squad limit override for ${result.clubName} cleared (effective limit: ${result.effectiveLimit}).`,
      });
      return;
    }

    // limit view is PUBLIC in bot-commands channel
    const teamId = execution.options.getString('team') ?? undefined;
    const view = await context.limitManagementService.viewLimit(execution.guildId, teamId);

    let content: string;
    if (view.selectedClub !== undefined) {
      content = [
        `**Squad Limit Details — ${view.selectedClub.name} (${view.selectedClub.shortName})**`,
        `Guild Default: ${view.defaultSquadLimit}`,
        `Team Override: ${view.selectedClub.override ?? 'None'}`,
        `Effective Limit: ${view.selectedClub.effectiveLimit}`,
      ].join('\n');
    } else {
      const overrideText =
        view.clubsWithOverrides.length === 0
          ? 'None'
          : view.clubsWithOverrides
              .map((c) => `- ${c.name} (${c.shortName}): ${c.override}`)
              .join('\n');
      content = [
        `**Squad Limit Configuration**`,
        `Guild Default: ${view.defaultSquadLimit}`,
        `__Team Overrides__:\n${overrideText}`,
      ].join('\n');
    }

    await interaction.reply({ content });
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
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await context.staffManagementService.appoint({
        authorization: execution.authorization,
        clubId: teamId,
        staffDiscordUserId: user.id,
        staffIsBot: user.bot,
        staffType: requiredString(execution.options, 'staff_type') as StaffType,
      });
      await interaction.editReply({
        content: `Appointed <@${result.user.discordUserId}> as ${result.membership.membershipType}.`,
      });
      return;
    }

    if (subcommand === 'remove') {
      const teamId = requiredString(execution.options, 'team');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const membership = await context.staffManagementService.remove(
        execution.authorization,
        teamId,
        requiredString(execution.options, 'staff_type') as StaffType,
      );
      await interaction.editReply({
        content: `Removed the active ${membership.membershipType} appointment.`,
      });
      return;
    }

    // staff list is PUBLIC in bot-commands channel
    const selectedTeamId = execution.options.getString('team');
    if (selectedTeamId) {
      const staff = await context.staffManagementService.list(execution.guildId, selectedTeamId);
      const byType = new Map(
        staff.map((membership) => [membership.membershipType, membership.user]),
      );
      const content = (['TEAM_MANAGER', 'ASSISTANT_MANAGER', 'PLAYER_MANAGER'] as const)
        .map(
          (type) =>
            `${type.replaceAll('_', ' ')}: ${byType.has(type) ? `<@${byType.get(type)?.discordUserId}>` : 'Vacant'}`,
        )
        .join('\n');
      await interaction.reply({ content });
      return;
    }

    const activeTeams = await context.clubManagementService.listActive(execution.guildId);
    if (activeTeams.length === 0) {
      await interaction.reply({ content: 'No active teams are registered.' });
      return;
    }

    const sections = await Promise.all(
      activeTeams.map(async ({ club }) => {
        const staff = await context.staffManagementService.list(execution.guildId, club.id);
        const byType = new Map(staff.map((m) => [m.membershipType, m.user]));
        const staffText = (['TEAM_MANAGER', 'ASSISTANT_MANAGER', 'PLAYER_MANAGER'] as const)
          .map(
            (t) =>
              `${t.replaceAll('_', ' ')}: ${byType.has(t) ? `<@${byType.get(t)?.discordUserId}>` : 'Vacant'}`,
          )
          .join(' | ');
        return `**${club.name} (${club.shortName})**\n${staffText}`;
      }),
    );

    const content = sections.join('\n\n').slice(0, 1900);
    await interaction.reply({ content });
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

    // roster view is PUBLIC in bot-commands channel
    const result = await context.rosterManagementService.list(execution.guildId, teamId);
    const settings = await context.guildConfigurationService
      .load(execution.guildId)
      .catch(() => null);

    const effectiveLimit = getEffectiveSquadLimit(result.club, settings?.settings);
    const remainingSpaces = Math.max(0, effectiveLimit - result.players.length);

    const content =
      result.players.length === 0
        ? `**${result.club.name} — 0/${effectiveLimit} (${remainingSpaces} spaces remaining)**\nNo active players.`
        : `**${result.club.name} — ${result.players.length}/${effectiveLimit} (${remainingSpaces} spaces remaining)**\n${result.players
            .map(({ user }) => `<@${user.discordUserId}>`)
            .join('\n')}`.slice(0, 1900);
    await interaction.reply({ content });
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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await context.offerDeliveryService.createAndDeliver({
      authorization: execution.authorization,
      destinationClubId: requiredString(execution.options, 'team'),
      playerDiscordUserId: player.id,
      playerIsBot: player.bot,
    });
    await interaction.editReply({
      content: `Offer sent privately to <@${result.player.discordUserId}>.`,
    });
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
