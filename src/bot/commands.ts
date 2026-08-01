import { ChannelType, MessageFlags, SlashCommandBuilder } from 'discord.js';

import { ConfigurationError, ValidationError } from '../domain/errors.js';
import { getEffectiveSquadLimit } from '../domain/squad-limit.js';
import {
  formatTeamBanner,
  teamBannerConfigFrom,
  type TeamBannerConfig,
} from '../domain/team-label.js';
import type { AuthorizationInput } from '../services/authorization-service.js';
import { getFriendlyPositionName, type StaffType } from '../services/staff-management-service.js';
import { createActorField, createInfoEmbed, createSuccessEmbed } from './embeds.js';
import { getTeamThumbnail, validateTeamEmoji } from './emoji-helper.js';
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

const auditDeliveryWarning =
  '⚠️ Configuration was saved, but the audit message could not be delivered.';

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

function requiredBoolean(options: CommandInteractionOptions, name: string): boolean {
  const value = options.getBoolean?.(name) ?? null;
  if (value === null) throw new ConfigurationError(`${name} is required`);
  return value;
}

async function loadTeamBannerConfig(
  context: CommandContext,
  discordGuildId: string,
): Promise<TeamBannerConfig> {
  const configuration = await context.guildConfigurationService.load(discordGuildId);
  return teamBannerConfigFrom(configuration.settings);
}

const exampleTeamBanner = {
  emoji: '<:examplept:100000000000000001>',
  name: 'Example Preview Team',
  shortName: 'EPT',
  discordRoleId: '100000000000000001',
  discordRoleName: 'ExamplePreviewTeam',
} as const;

function bannerConfigurationText(config: TeamBannerConfig): string {
  return [
    `Emoji: ${config.bannerHasEmoji ? 'Enabled' : 'Disabled'}`,
    `Name: ${config.bannerHasName ? 'Enabled' : 'Disabled'}`,
    `Short Name: ${config.bannerHasShort ? 'Enabled' : 'Disabled'}`,
    `Role: ${config.bannerHasRole ? 'Enabled' : 'Disabled'}`,
  ].join('\n');
}

function bannerPreview(config: TeamBannerConfig): string {
  return formatTeamBanner(exampleTeamBanner, config, 'autocomplete');
}

function rosterTitleIdentity(
  team: Parameters<typeof formatTeamBanner>[0],
  config: TeamBannerConfig,
): string {
  if (config.bannerHasEmoji || config.bannerHasName) {
    return formatTeamBanner(team, {
      bannerHasEmoji: config.bannerHasEmoji,
      bannerHasName: config.bannerHasName,
      bannerHasShort: false,
      bannerHasRole: false,
    });
  }
  if (config.bannerHasShort) {
    return formatTeamBanner(team, {
      bannerHasEmoji: false,
      bannerHasName: false,
      bannerHasShort: true,
      bannerHasRole: false,
    });
  }
  return 'Team';
}

const staffPositions = [
  { type: 'TEAM_MANAGER', emoji: '👑', name: 'Team Manager' },
  { type: 'ASSISTANT_MANAGER', emoji: '👔', name: 'Assistant Team Manager' },
  { type: 'PLAYER_MANAGER', emoji: '🧠', name: 'Player Manager' },
] as const;

function staffDirectoryBlock(
  staff: ReadonlyArray<{ membershipType: string; user: { discordUserId: string } }>,
): string {
  const byType = new Map(staff.map((membership) => [membership.membershipType, membership.user]));
  return staffPositions
    .map(({ type, emoji, name }) => {
      const user = byType.get(type);
      return `${emoji} ${name}: ${user ? `<@${user.discordUserId}>` : 'Vacant'}`;
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
      Object.fromEntries((interaction.getGuildRoles?.() ?? []).map((role) => [role.id, role.name])),
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
        { name: 'Bot Status', value: 'Online ✅', inline: true },
        { name: 'Database', value: connected ? 'Connected ✅' : 'Unavailable ❌', inline: true },
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

    if (subcommand === 'league') {
      const timeoutMinutes = execution.options.getInteger('offer_timeout_minutes');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await context.guildSetupService.setupGuildOnly({
        authorization: execution.authorization,
        guildName: execution.guildName,
        ...(timeoutMinutes === null ? {} : { offerTimeoutSeconds: timeoutMinutes * 60 }),
      });
      const title = '✅ League Settings Updated';
      const description = `League configuration ${result.created ? 'initialized' : 'updated'} for **${result.guild.name}**.`;
      const auditFields = [
        {
          name: '⏰ Offer Timeout',
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
          createActorField('Configured', execution.authorization.discordUserId),
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
        `🤖 Bot Commands: <#${botCmds.id}>`,
        `🛡️ Staff Commands: <#${staff.id}>`,
        `🔄 Transfers: <#${transfer.id}>`,
        `📋 Audit Logs: <#${audit.id}>`,
      ].join('\n');

      const title = '✅ System Channels Configured';
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
          createActorField('Configured', execution.authorization.discordUserId),
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
        `🧠 Bot Permissions: <@&${botPerms.id}>`,
        `👑 Team Manager: <@&${tm.id}>`,
        `👔 Assistant Team Manager: <@&${atm.id}>`,
        `👤 Player Manager: <@&${pm.id}>`,
      ].join('\n');

      const title = '✅ League Roles Configured';
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
          createActorField('Configured', execution.authorization.discordUserId),
        ],
      });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'view') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const view = await context.guildSetupService.getView(execution.guildId);

      const channelLines = [
        `🤖 Bot Commands: ${view.channels.botCommandsChannelId ? `<#${view.channels.botCommandsChannelId}>` : 'Not configured'}`,
        `🛡️ Staff Commands: ${view.channels.staffChannelId ? `<#${view.channels.staffChannelId}>` : 'Not configured'}`,
        `🔄 Transfers: ${view.channels.transferChannelId ? `<#${view.channels.transferChannelId}>` : 'Not configured'}`,
        `📋 Audit Logs: ${view.channels.auditChannelId ? `<#${view.channels.auditChannelId}>` : 'Not configured'}`,
      ].join('\n');

      const roleLines = [
        `🧠 Bot Permissions: ${view.roles.botPermissionsRoleId ? `<@&${view.roles.botPermissionsRoleId}>` : 'Not configured'}`,
        `👑 Team Manager: ${view.roles.teamManagerRoleId ? `<@&${view.roles.teamManagerRoleId}>` : 'Not configured'}`,
        `👔 Assistant Team Manager: ${view.roles.assistantManagerRoleId ? `<@&${view.roles.assistantManagerRoleId}>` : 'Not configured'}`,
        `👤 Player Manager: ${view.roles.playerManagerRoleId ? `<@&${view.roles.playerManagerRoleId}>` : 'Not configured'}`,
      ].join('\n');

      const missingText =
        view.missingConfigurations.length === 0
          ? 'None (Complete)'
          : view.missingConfigurations.join(', ');

      const embed = createSuccessEmbed({
        title: `✅ League Configuration — ${view.guildName}`,
        fields: [
          { name: 'Channels', value: channelLines, inline: false },
          { name: 'Roles', value: roleLines, inline: false },
          {
            name: 'Settings',
            value: `👥 Default Squad Limit: ${view.defaultSquadLimit}\n⏰ Offer Lifetime: ${view.offerTimeoutMinutes} minutes`,
            inline: false,
          },
          {
            name: 'Team Banner',
            value: bannerConfigurationText(view.banner),
            inline: false,
          },
          { name: 'Preview', value: bannerPreview(view.banner), inline: false },
          { name: 'Missing Configuration', value: missingText, inline: false },
        ],
      });

      await interaction.editReply({ embeds: [embed] });
    }
  },
};

const bannerConfigCommand: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('bannerconfig')
    .setDescription('Configure the guild team banner components')
    .addBooleanOption((option) =>
      option.setName('has_emoji').setDescription('Show the team emoji').setRequired(true),
    )
    .addBooleanOption((option) =>
      option.setName('has_name').setDescription('Show the team name').setRequired(true),
    )
    .addBooleanOption((option) =>
      option.setName('has_short').setDescription('Show the short team name').setRequired(true),
    )
    .addBooleanOption((option) =>
      option.setName('has_role').setDescription('Show the Discord team role').setRequired(true),
    ),
  async execute(interaction, context) {
    const execution = await enforceChannelPolicy(interaction, context);
    const requested = {
      bannerHasEmoji: requiredBoolean(execution.options, 'has_emoji'),
      bannerHasName: requiredBoolean(execution.options, 'has_name'),
      bannerHasShort: requiredBoolean(execution.options, 'has_short'),
      bannerHasRole: requiredBoolean(execution.options, 'has_role'),
    };

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const updateBannerConfiguration = context.guildSetupService.updateBannerConfiguration;
    if (updateBannerConfiguration === undefined) {
      throw new ConfigurationError('team banner configuration service is unavailable');
    }
    const result = await updateBannerConfiguration.call(context.guildSetupService, {
      authorization: execution.authorization,
      ...requested,
    });
    const title = '✅ Team Banner Configuration Updated';
    const preview = bannerPreview(result.after);
    const configurationText = bannerConfigurationText(result.after);
    const auditFields = [
      { name: 'Enabled Components', value: configurationText, inline: false },
      { name: 'Team Banner Preview', value: preview, inline: false },
    ];
    const auditPublished = await publishSetupAudit(context, {
      channelId: result.settings.auditChannelId,
      title,
      description: 'Successfully updated the guild team banner configuration.',
      fields: auditFields,
      actorDiscordUserId: execution.authorization.discordUserId,
    });
    const embed = createSuccessEmbed({
      title,
      description: withAuditWarning(
        'Successfully updated the guild team banner configuration.',
        auditPublished,
      ),
      fields: [
        { name: 'Team Banner Preview', value: preview, inline: false },
        { name: 'Enabled Components', value: configurationText, inline: false },
        createActorField('Configured', execution.authorization.discordUserId),
      ],
    });
    await interaction.editReply({ embeds: [embed] });
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
        .addStringOption((option) => option.setName('name').setDescription('New team name'))
        .addStringOption((option) => option.setName('short_name').setDescription('New short name'))
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
    const bannerConfig = await loadTeamBannerConfig(context, execution.guildId);

    if (subcommand === 'add') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const rawEmoji = requiredString(execution.options, 'emoji');
      const validatedEmoji = validateTeamEmoji(rawEmoji, guildEmojis);

      const club = await context.clubManagementService.create({
        authorization: execution.authorization,
        name: requiredString(execution.options, 'name'),
        shortName: requiredString(execution.options, 'short_name'),
        discordRoleId: requiredRole(execution.options, 'role').id,
        emoji: validatedEmoji.display,
      });

      const thumbnail = getTeamThumbnail(club.emoji, club.logoUrl);
      const embed = createSuccessEmbed({
        title: '✅ Team Added',
        description: `Successfully created team ${formatTeamBanner(club, bannerConfig)}.`,
        fields: [
          { name: 'Squad Limit', value: 'Guild Default', inline: true },
          createActorField('Added', execution.authorization.discordUserId),
        ],
        thumbnail,
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'edit') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const teamId = requiredString(execution.options, 'team');
      const name = execution.options.getString('name') ?? undefined;
      const shortName = execution.options.getString('short_name') ?? undefined;
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
        ...(name === undefined ? {} : { name }),
        ...(shortName === undefined ? {} : { shortName }),
        ...(role === null ? {} : { discordRoleId: role.id }),
        ...(emojiToUpdate === undefined ? {} : { emoji: emojiToUpdate }),
      });

      const thumbnail = getTeamThumbnail(club.emoji, club.logoUrl);
      const embed = createSuccessEmbed({
        title: '✅ Team Updated',
        description: `Successfully updated ${formatTeamBanner(club, bannerConfig)}.`,
        fields: [createActorField('Edited', execution.authorization.discordUserId)],
        thumbnail,
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'remove') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const teamId = requiredString(execution.options, 'team');
      const club = await context.clubManagementService.deactivate(execution.authorization, teamId);

      const thumbnail = getTeamThumbnail(club.emoji, club.logoUrl);
      const embed = createSuccessEmbed({
        title: '✅ Team Removed',
        description: `Successfully deactivated ${formatTeamBanner(club, bannerConfig)}. The team is now inactive.`,
        fields: [
          { name: 'Status', value: 'Inactive', inline: true },
          {
            name: 'Historical Data',
            value:
              'Historical memberships, staff appointments, offers, transactions, and audit records are preserved.',
            inline: false,
          },
          createActorField('Removed', execution.authorization.discordUserId),
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
      return `${formatTeamBanner(club, bannerConfig)} — ${activePlayerCount}/${effectiveLimit}`;
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
    const bannerConfig = await loadTeamBannerConfig(context, execution.guildId);

    if (subcommand === 'default') {
      const amount = requiredInteger(execution.options, 'amount');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await context.limitManagementService.setDefaultLimit({
        authorization: execution.authorization,
        amount,
      });

      const embed = createSuccessEmbed({
        title: '✅ Squad Limit Updated',
        description: `Guild-wide default squad limit set to **${result.defaultSquadLimit}** players.`,
        fields: [createActorField('Updated', execution.authorization.discordUserId)],
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

      const embed = createSuccessEmbed({
        title: '✅ Team Squad Limit Updated',
        description: `Squad limit override for ${formatTeamBanner(result.club, bannerConfig)} set to **${result.override}** (effective limit: **${result.effectiveLimit}**).`,
        fields: [createActorField('Updated', execution.authorization.discordUserId)],
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

      const embed = createSuccessEmbed({
        title: '✅ Team Squad Limit Reset',
        description: `Squad limit override for ${formatTeamBanner(result.club, bannerConfig)} cleared (effective limit: **${result.effectiveLimit}**).`,
        fields: [createActorField('Reset', execution.authorization.discordUserId)],
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // limit view is public
    const teamId = execution.options.getString('team') ?? undefined;
    const view = await context.limitManagementService.viewLimit(execution.guildId, teamId);

    if (view.selectedClub !== undefined) {
      const thumbnail = getTeamThumbnail(view.selectedClub.emoji, view.selectedClub.logoUrl);
      const embed = createInfoEmbed({
        title: 'Squad Limit',
        description: formatTeamBanner(view.selectedClub, bannerConfig),
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
            .map((club) => `- ${formatTeamBanner(club, bannerConfig)}: ${club.override}`)
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
              { name: 'Assistant Team Manager', value: 'ASSISTANT_MANAGER' },
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
              { name: 'Assistant Team Manager', value: 'ASSISTANT_MANAGER' },
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
    const execution = await enforceChannelPolicy(interaction, context);
    const subcommand = execution.options.getSubcommand();
    const bannerConfig = await loadTeamBannerConfig(context, execution.guildId);

    if (subcommand === 'appoint') {
      const teamId = requiredString(execution.options, 'team');
      const user = requiredUser(execution.options, 'user');
      const staffType = requiredString(execution.options, 'staff_type') as StaffType;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await context.staffManagementService.appoint({
        authorization: execution.authorization,
        clubId: teamId,
        staffDiscordUserId: user.id,
        staffIsBot: user.bot,
        staffType,
      });

      const positionName = getFriendlyPositionName(staffType);
      const embed = createSuccessEmbed({
        title: '✅ Staff Member Appointed',
        description: `Successfully appointed <@${result.user.discordUserId}> as the ${positionName} of ${formatTeamBanner(result.club, bannerConfig)}.`,
        fields: [createActorField('Appointed', execution.authorization.discordUserId)],
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

      const positionName = getFriendlyPositionName(staffType);
      const embed = createSuccessEmbed({
        title: '✅ Staff Member Removed',
        description: `Successfully removed <@${result.user.discordUserId}> as the ${positionName} of ${formatTeamBanner(result.club, bannerConfig)}.`,
        fields: [createActorField('Removed', execution.authorization.discordUserId)],
      });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // staff list is public
    const selectedTeamId = execution.options.getString('team');
    if (selectedTeamId) {
      const staff = await context.staffManagementService.list(execution.guildId, selectedTeamId);
      const activeTeams = await context.clubManagementService.listActive(execution.guildId);
      const selectedClubItem = activeTeams.find((item) => item.club.id === selectedTeamId);
      const thumbnail = selectedClubItem
        ? getTeamThumbnail(selectedClubItem.club.emoji, selectedClubItem.club.logoUrl)
        : null;

      const embed = createInfoEmbed({
        title: 'Team Staff',
        ...(selectedClubItem
          ? {
              fields: [
                {
                  name: '\u200b',
                  value: `${formatTeamBanner(selectedClubItem.club, bannerConfig)}\n\n${staffDirectoryBlock(staff)}`,
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
        return {
          name: '\u200b',
          value: `${formatTeamBanner(club, bannerConfig)}\n\n${staffDirectoryBlock(staff)}`,
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
    const thumbnail = getTeamThumbnail(result.club.emoji, result.club.logoUrl);
    const bannerConfig = teamBannerConfigFrom(settings?.settings);
    const fullBanner = formatTeamBanner(result.club, bannerConfig);
    const titleIdentity = rosterTitleIdentity(result.club, bannerConfig);

    const staffByType = new Map(result.staff.map((m) => [m.membershipType, m.user]));
    const tmUser = staffByType.get('TEAM_MANAGER');
    const atmUser = staffByType.get('ASSISTANT_MANAGER');
    const pmUser = staffByType.get('PLAYER_MANAGER');

    const tmLine = tmUser ? `• <@${tmUser.discordUserId}>` : 'None';
    const atmLine = atmUser ? `• <@${atmUser.discordUserId}>` : 'None';
    const pmLine = pmUser ? `• <@${pmUser.discordUserId}>` : 'None';

    const playerLines =
      result.players.length === 0
        ? 'None'
        : result.players.map(({ user }) => `• <@${user.discordUserId}>`).join('\n');

    const leagueName = settings?.guild?.name ?? execution.guildName;

    const embed = createInfoEmbed({
      author: { name: leagueName },
      title: `${titleIdentity} Roster`,
      ...(fullBanner === titleIdentity ? {} : { description: fullBanner }),
      fields: [
        {
          name: '📊 Roster Count',
          value: `${result.players.length}/${effectiveLimit}`,
          inline: false,
        },
        { name: '👑 Team Manager', value: tmLine, inline: false },
        { name: '👔 Assistant Team Manager', value: atmLine, inline: false },
        { name: '🧠 Player Manager', value: pmLine, inline: false },
        { name: '──────── Players ────────', value: '\u200b', inline: false },
        { name: '🏃 Players', value: playerLines.slice(0, 1024), inline: false },
      ],
      thumbnail,
      footer: `Roster for ${leagueName}`,
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

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // derive the team from the staff appointment
    const destinationClub = await context.staffManagementService.getCallerActiveStaffClub(
      execution.guildId,
      execution.authorization.discordUserId,
    );

    const result = await context.offerDeliveryService.createAndDeliver({
      authorization: execution.authorization,
      destinationClubId: destinationClub.id,
      playerDiscordUserId: player.id,
      playerIsBot: player.bot,
    });

    const club = result.destinationClub;
    const thumbnail = getTeamThumbnail(club?.emoji, club?.logoUrl);
    const embed = createSuccessEmbed({
      title: '✅ Contract Offer Sent',
      description: `A private contract offer has been sent to <@${result.player.discordUserId}> on behalf of ${formatTeamBanner(club ?? destinationClub, teamBannerConfigFrom(result.bannerConfig))}.`,
      fields: [
        { name: 'Target Player', value: `<@${result.player.discordUserId}>`, inline: true },
        {
          name: 'Source Team',
          value: formatTeamBanner(
            club ?? destinationClub,
            teamBannerConfigFrom(result.bannerConfig),
          ),
          inline: true,
        },
      ],
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

export const commandDefinitions = [
  healthCommand,
  setupCommand,
  bannerConfigCommand,
  teamCommand,
  limitCommand,
  staffCommand,
  rosterCommand,
  offerCommand,
  ...(process.env['SLBOT_ENABLE_DEBUG_COMMANDS'] === 'true' ? [debugResetCommand] : []),
] satisfies readonly CommandDefinition[];
