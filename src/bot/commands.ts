import { ChannelType, MessageFlags, SlashCommandBuilder } from 'discord.js';

import { ConfigurationError } from '../domain/errors.js';
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

function requiredChannel(options: CommandInteractionOptions, name: string): { id: string } {
  const value = options.getChannel(name);
  if (value === null) throw new ConfigurationError(`${name} is required`);
  return value;
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
        .setDescription('Create or update server configuration')
        .addChannelOption((option) =>
          option
            .setName('transfer_channel')
            .setDescription('Channel for player offers')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        )
        .addChannelOption((option) =>
          option
            .setName('audit_channel')
            .setDescription('Channel reserved for audit messages')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        )
        .addRoleOption((option) =>
          option
            .setName('league_admin_role')
            .setDescription('League administrator role')
            .setRequired(true),
        )
        .addRoleOption((option) =>
          option.setName('team_manager_role').setDescription('Team manager role').setRequired(true),
        )
        .addRoleOption((option) =>
          option
            .setName('assistant_manager_role')
            .setDescription('Assistant manager role')
            .setRequired(true),
        )
        .addRoleOption((option) =>
          option
            .setName('player_manager_role')
            .setDescription('Player manager role')
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName('offer_timeout_minutes')
            .setDescription('Default offer lifetime in minutes')
            .setMinValue(1)
            .setMaxValue(10080),
        ),
    ),
  async execute(interaction, context) {
    const execution = requireExecution(interaction);
    const timeoutMinutes = execution.options.getInteger('offer_timeout_minutes');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await context.guildSetupService.setup({
      authorization: execution.authorization,
      guildName: execution.guildName,
      transferChannelId: requiredChannel(execution.options, 'transfer_channel').id,
      auditChannelId: requiredChannel(execution.options, 'audit_channel').id,
      adminRoleId: requiredRole(execution.options, 'league_admin_role').id,
      teamManagerRoleId: requiredRole(execution.options, 'team_manager_role').id,
      assistantManagerRoleId: requiredRole(execution.options, 'assistant_manager_role').id,
      playerManagerRoleId: requiredRole(execution.options, 'player_manager_role').id,
      ...(timeoutMinutes === null ? {} : { offerTimeoutSeconds: timeoutMinutes * 60 }),
    });
    await interaction.editReply({
      content: `${result.created ? 'Configured' : 'Updated'} ${result.guild.name}. Completed transaction announcements will use <#${result.settings.transferChannelId}>.`,
    });
  },
};

const teamCommand: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('team')
    .setDescription('Manage league teams')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('create')
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
        .addIntegerOption((option) =>
          option
            .setName('squad_limit')
            .setDescription('Maximum active players')
            .setMinValue(1)
            .setMaxValue(100)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('logo_url').setDescription('Optional team logo URL'),
        )
        .addStringOption((option) => option.setName('emoji').setDescription('Optional team emoji')),
    )
    .addSubcommand((subcommand) => subcommand.setName('list').setDescription('List active teams'))
    .addSubcommand((subcommand) =>
      subcommand
        .setName('deactivate')
        .setDescription('Deactivate a team without deleting history')
        .addStringOption((option) =>
          option
            .setName('team')
            .setDescription('Team to deactivate')
            .setAutocomplete(true)
            .setRequired(true),
        ),
    ),
  async execute(interaction, context) {
    const execution = requireExecution(interaction);
    const subcommand = execution.options.getSubcommand();
    if (subcommand === 'create') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const club = await context.clubManagementService.create({
        authorization: execution.authorization,
        name: requiredString(execution.options, 'name'),
        shortName: requiredString(execution.options, 'short_name'),
        discordRoleId: requiredRole(execution.options, 'role').id,
        squadLimit: requiredInteger(execution.options, 'squad_limit'),
        logoUrl: execution.options.getString('logo_url'),
        emoji: execution.options.getString('emoji'),
      });
      await interaction.editReply({
        content: `Created ${club.name} (${club.shortName}) linked to <@&${club.discordRoleId}> with a ${club.squadLimit}-player limit.`,
      });
      return;
    }
    if (subcommand === 'deactivate') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const club = await context.clubManagementService.deactivate(
        execution.authorization,
        requiredString(execution.options, 'team'),
      );
      await interaction.editReply({ content: `${club.name} is now inactive.` });
      return;
    }
    const teams = await context.clubManagementService.listActive(execution.guildId);
    const content =
      teams.length === 0
        ? 'No active teams are registered.'
        : teams
            .map(
              ({ club, activePlayerCount }) =>
                `**${club.name} (${club.shortName})** <@&${club.discordRoleId}> — ${activePlayerCount}/${club.squadLimit}`,
            )
            .join('\n')
            .slice(0, 1900);
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
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
          option.setName('team').setDescription('Team').setAutocomplete(true).setRequired(true),
        ),
    ),
  async execute(interaction, context) {
    const execution = requireExecution(interaction);
    const teamId = requiredString(execution.options, 'team');
    const subcommand = execution.options.getSubcommand();
    if (subcommand === 'appoint') {
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
    const staff = await context.staffManagementService.list(execution.guildId, teamId);
    const byType = new Map(staff.map((membership) => [membership.membershipType, membership.user]));
    const content = (['TEAM_MANAGER', 'ASSISTANT_MANAGER', 'PLAYER_MANAGER'] as const)
      .map(
        (type) =>
          `${type.replaceAll('_', ' ')}: ${byType.has(type) ? `<@${byType.get(type)?.discordUserId}>` : 'Vacant'}`,
      )
      .join('\n');
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  },
  autocomplete: autocompleteTeam,
};

const rosterCommand: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('roster')
    .setDescription('Manage team rosters')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Add an existing player to a roster')
        .addStringOption((option) =>
          option.setName('team').setDescription('Team').setAutocomplete(true).setRequired(true),
        )
        .addUserOption((option) =>
          option.setName('player').setDescription('Player').setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('roblox_username').setDescription('Optional Roblox username'),
        )
        .addStringOption((option) =>
          option.setName('roblox_user_id').setDescription('Optional Roblox user ID'),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('Remove an active player from a roster')
        .addStringOption((option) =>
          option.setName('team').setDescription('Team').setAutocomplete(true).setRequired(true),
        )
        .addUserOption((option) =>
          option.setName('player').setDescription('Player').setRequired(true),
        )
        .addStringOption((option) =>
          option.setName('reason').setDescription('Optional release reason'),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('List active players')
        .addStringOption((option) =>
          option.setName('team').setDescription('Team').setAutocomplete(true).setRequired(true),
        ),
    ),
  async execute(interaction, context) {
    const execution = requireExecution(interaction);
    const teamId = requiredString(execution.options, 'team');
    const subcommand = execution.options.getSubcommand();
    if (subcommand === 'add') {
      const player = requiredUser(execution.options, 'player');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await context.rosterManagementService.add({
        authorization: execution.authorization,
        clubId: teamId,
        playerDiscordUserId: player.id,
        playerIsBot: player.bot,
        robloxUsername: execution.options.getString('roblox_username'),
        robloxUserId: execution.options.getString('roblox_user_id'),
      });
      await interaction.editReply({
        content: `Added <@${result.player.discordUserId}> to ${result.club.name}.`,
      });
      return;
    }
    if (subcommand === 'remove') {
      const player = requiredUser(execution.options, 'player');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await context.rosterManagementService.remove(
        execution.authorization,
        teamId,
        player.id,
        execution.options.getString('reason'),
      );
      await interaction.editReply({
        content: `Removed <@${result.player.discordUserId}> from ${result.club.name}.`,
      });
      return;
    }
    const result = await context.rosterManagementService.list(execution.guildId, teamId);
    const content =
      result.players.length === 0
        ? `${result.club.name} has no active players.`
        : `**${result.club.name} — ${result.players.length}/${result.club.squadLimit}**\n${result.players
            .map(({ user }) => `<@${user.discordUserId}>`)
            .join('\n')}`.slice(0, 1900);
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
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
  staffCommand,
  rosterCommand,
  offerCommand,
] satisfies readonly CommandDefinition[];
