import {
  MessageFlags,
  PermissionsBitField,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
} from 'discord.js';

import type { Logger } from '../logging/logger.js';
import type { GuildMemberSnapshot } from '../services/data-import-service.js';
import type { CommandRegistry } from './command-registry.js';
import { createErrorEmbed } from './embeds.js';
import { mapDiscordError } from './error-mapper.js';
import { BOT_EMOJIS } from './presentation/index.js';
import type { OfferButtonInteraction } from './offer-button-handler.js';
import { sendDebugResetPrompt } from './debug-reset-handler.js';
import type { GuildEmoji } from './emoji-helper.js';
import type {
  CommandAutocompleteInteraction,
  CommandContext,
  CommandInteraction,
  CommandInteractionOptions,
  ButtonInteractionAdapter,
  DeferredInteractionResponse,
  EditedInteractionResponse,
  SafeInteractionResponse,
} from './types.js';

type ResolvableDiscordInteraction = ChatInputCommandInteraction | ButtonInteraction;

function memberDisplayName(member: {
  displayName: string;
  user: { globalName: string | null; username: string };
}): string {
  return member.displayName.trim() || member.user.globalName || member.user.username;
}

function invokingUserDisplayName(interaction: ResolvableDiscordInteraction): string {
  const member = interaction.member;
  if (
    member &&
    typeof member === 'object' &&
    'displayName' in member &&
    typeof member.displayName === 'string'
  ) {
    return member.displayName.trim() || interaction.user.globalName || interaction.user.username;
  }
  return interaction.user.globalName || interaction.user.username;
}

async function resolveGuildMemberDisplayName(
  interaction: ResolvableDiscordInteraction,
  logger: Logger,
  userId: string,
): Promise<string | null> {
  if (interaction.user.id === userId) return invokingUserDisplayName(interaction);

  const guild = interaction.guild;
  const cachedMember = guild?.members.cache.get(userId);
  if (cachedMember !== undefined) return memberDisplayName(cachedMember);

  logger.debug('Discord guild member cache miss', {
    guildId: guild?.id ?? null,
    userId,
  });

  if (guild !== null) {
    try {
      const fetchedMember = await guild.members.fetch(userId);
      logger.debug('Discord guild member fetch succeeded', { guildId: guild.id, userId });
      return memberDisplayName(fetchedMember);
    } catch (error: unknown) {
      logger.debug('Discord guild member fetch failed', { guildId: guild.id, userId, error });
    }
  }

  const cachedUser = interaction.client.users.cache.get(userId);
  if (cachedUser !== undefined) return cachedUser.globalName || cachedUser.username;

  try {
    const fetchedUser = await interaction.client.users.fetch(userId);
    logger.debug('Discord user fetch succeeded', { userId });
    return fetchedUser.globalName || fetchedUser.username;
  } catch (error: unknown) {
    logger.debug('Discord user fetch failed', { userId, error });
    return null;
  }
}

async function resolveGuildRoleMetadata(
  interaction: ResolvableDiscordInteraction,
  logger: Logger,
  roleId: string,
): Promise<{ id: string; name: string; color: number } | null> {
  const guilds = interaction.guild
    ? [interaction.guild]
    : [...interaction.client.guilds.cache.values()];

  for (const guild of guilds) {
    const cachedRole = guild.roles.cache.get(roleId);
    if (cachedRole !== undefined) {
      return { id: cachedRole.id, name: cachedRole.name, color: cachedRole.color };
    }
  }

  logger.debug('Discord guild role cache miss', {
    guildId: interaction.guild?.id ?? null,
    roleId,
  });

  for (const guild of guilds) {
    try {
      const fetchedRole = await guild.roles.fetch(roleId);
      if (fetchedRole !== null) {
        logger.debug('Discord guild role fetch succeeded', { guildId: guild.id, roleId });
        return { id: fetchedRole.id, name: fetchedRole.name, color: fetchedRole.color };
      }
      logger.debug('Discord guild role fetch failed', {
        guildId: guild.id,
        roleId,
        error: 'role was not found',
      });
    } catch (error: unknown) {
      logger.debug('Discord guild role fetch failed', { guildId: guild.id, roleId, error });
    }
  }

  return null;
}

class DiscordCommandOptions implements CommandInteractionOptions {
  public constructor(private readonly interaction: ChatInputCommandInteraction) {}

  public getSubcommand(): string | null {
    try {
      return this.interaction.options.getSubcommand();
    } catch {
      return null;
    }
  }

  public getSubcommandGroup(): string | null {
    try {
      return this.interaction.options.getSubcommandGroup();
    } catch {
      return null;
    }
  }

  public getString(name: string): string | null {
    return this.interaction.options.getString(name);
  }

  public getInteger(name: string): number | null {
    return this.interaction.options.getInteger(name);
  }

  public getUser(name: string): { id: string; bot: boolean; displayName?: string } | null {
    const user = this.interaction.options.getUser(name);
    if (user === null) return null;
    const member = this.interaction.options.getMember(name);
    const displayName =
      member &&
      typeof member === 'object' &&
      'displayName' in member &&
      typeof member.displayName === 'string'
        ? member.displayName.trim()
        : user.globalName || user.username;
    return { id: user.id, bot: user.bot, displayName: displayName || 'Unknown User' };
  }

  public getRole(name: string): { id: string } | null {
    const role = this.interaction.options.getRole(name);
    return role === null ? null : { id: role.id };
  }

  public getChannel(name: string): { id: string; type: number } | null {
    const channel = this.interaction.options.getChannel(name);
    return channel === null ? null : { id: channel.id, type: channel.type };
  }
}

export class DiscordCommandInteraction implements CommandInteraction {
  public constructor(
    private readonly interaction: ChatInputCommandInteraction,
    private readonly logger: Logger,
  ) {}

  public get commandName(): string {
    return this.interaction.commandName;
  }

  public get replied(): boolean {
    return this.interaction.replied;
  }

  public get deferred(): boolean {
    return this.interaction.deferred;
  }

  public get guildId(): string | undefined {
    return this.interaction.guildId ?? undefined;
  }

  public get guildName(): string | undefined {
    return this.interaction.guild?.name;
  }

  public get guildIconUrl(): string | undefined {
    return this.interaction.guild?.iconURL() ?? undefined;
  }

  public get guildOwnerId(): string | undefined {
    return this.interaction.guild?.ownerId;
  }

  public get userId(): string {
    return this.interaction.user.id;
  }

  public get userDisplayName(): string {
    const member = this.interaction.member;
    if (
      member &&
      typeof member === 'object' &&
      'displayName' in member &&
      typeof member.displayName === 'string'
    ) {
      return (
        member.displayName.trim() ||
        this.interaction.user.globalName ||
        this.interaction.user.username
      );
    }
    return this.interaction.user.globalName || this.interaction.user.username;
  }

  public get channelId(): string | undefined {
    return this.interaction.channelId;
  }

  public get memberRoleIds(): readonly string[] {
    const roles = this.interaction.member?.roles;
    if (roles === undefined) return [];
    return Array.isArray(roles) ? roles : [...roles.cache.keys()];
  }

  public get hasAdministratorPermission(): boolean {
    return (
      this.interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) ?? false
    );
  }

  public get options(): CommandInteractionOptions {
    return new DiscordCommandOptions(this.interaction);
  }

  public getGuildEmojis(): readonly GuildEmoji[] {
    const emojis = this.interaction.guild?.emojis.cache.values();
    if (emojis === undefined) return [];
    return [...emojis]
      .filter((emoji): emoji is typeof emoji & { name: string } => emoji.name !== null)
      .map((emoji) => ({ id: emoji.id, name: emoji.name, animated: emoji.animated ?? false }));
  }

  public getGuildRoleMetadata(roleId: string): {
    id: string;
    name: string;
    color: number;
  } | null {
    const role = this.interaction.guild?.roles.cache.get(roleId);
    return role === undefined ? null : { id: role.id, name: role.name, color: role.color };
  }

  public getGuildMemberDisplayName(userId: string): string | null {
    if (this.interaction.user.id === userId) {
      const member = this.interaction.member;
      if (
        member &&
        typeof member === 'object' &&
        'displayName' in member &&
        typeof member.displayName === 'string'
      ) {
        return (
          member.displayName.trim() ||
          this.interaction.user.globalName ||
          this.interaction.user.username
        );
      }
      return this.interaction.user.globalName || this.interaction.user.username;
    }
    const member = this.interaction.guild?.members.cache.get(userId);
    if (member) {
      return member.displayName.trim() || member.user.globalName || member.user.username;
    }
    const user = this.interaction.client.users.cache.get(userId);
    if (user) {
      return user.globalName || user.username;
    }
    return null;
  }

  public async resolveGuildMemberDisplayName(userId: string): Promise<string | null> {
    return resolveGuildMemberDisplayName(this.interaction, this.logger, userId);
  }

  public async resolveGuildRoleMetadata(roleId: string): Promise<{
    id: string;
    name: string;
    color: number;
  } | null> {
    return resolveGuildRoleMetadata(this.interaction, this.logger, roleId);
  }

  public async fetchGuildMembers(): Promise<readonly GuildMemberSnapshot[]> {
    const guild = this.interaction.guild;
    if (guild === null) {
      throw new Error('guild members cannot be fetched outside a Discord server');
    }
    const members = await guild.members.fetch();
    return [...members.values()].map((member) => ({
      discordUserId: member.id,
      displayName:
        member.displayName.trim() ||
        member.user.globalName ||
        member.user.username ||
        'Unknown User',
      roleIds: [...member.roles.cache.keys()],
      bot: member.user.bot,
    }));
  }

  public async executeDebugReset(
    database: CommandContext['database'],
    setupAuditService?: CommandContext['setupAuditService'],
  ): Promise<void> {
    await sendDebugResetPrompt(this.interaction, database, setupAuditService);
  }

  public async reply(response: SafeInteractionResponse): Promise<void> {
    await this.interaction.reply(response);
  }

  public async deferReply(response?: DeferredInteractionResponse): Promise<void> {
    await this.interaction.deferReply(response);
  }

  public async editReply(response: EditedInteractionResponse): Promise<void> {
    await this.interaction.editReply(response);
  }

  public async followUp(response: SafeInteractionResponse): Promise<void> {
    await this.interaction.followUp(response);
  }

  public async deleteReply(): Promise<void> {
    await this.interaction.deleteReply();
  }
}

export async function handleInteractionCreate(
  interaction: CommandInteraction | null,
  registry: CommandRegistry,
  context: CommandContext,
  logger: Logger,
): Promise<void> {
  if (interaction === null) return;
  const command = registry.resolve(interaction.commandName);
  if (command === null) {
    logger.warn('unknown command received', { commandName: interaction.commandName });
    await interaction
      .reply({
        embeds: [
          createErrorEmbed({
            title: `${BOT_EMOJIS.error} Command Unavailable`,
            description: 'This command is no longer available. Refresh your Discord commands.',
          }),
        ],
        flags: MessageFlags.Ephemeral,
      })
      .catch((error: unknown) => {
        logger.warn('unknown command response could not be sent', {
          commandName: interaction.commandName,
          error,
        });
      });
    return;
  }

  try {
    await command.execute(interaction, context);
  } catch (error: unknown) {
    logger.error('command execution failed', error, { commandName: interaction.commandName });

    const mapped = mapDiscordError(error);
    const response: SafeInteractionResponse = {
      embeds: [mapped.embed],
      flags: MessageFlags.Ephemeral,
    };
    try {
      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({ embeds: [mapped.embed] });
      } else if (interaction.replied) {
        await interaction.followUp(response);
      } else {
        await interaction.reply(response);
      }
    } catch (responseError: unknown) {
      logger.warn('command failure response could not be sent', {
        commandName: interaction.commandName,
        error: responseError,
      });
    }
  }
}

class DiscordAutocomplete implements CommandAutocompleteInteraction {
  public constructor(private readonly interaction: AutocompleteInteraction) {}

  public get commandName(): string {
    return this.interaction.commandName;
  }

  public get guildId(): string | null {
    return this.interaction.guildId;
  }

  public get focusedName(): string {
    return this.interaction.options.getFocused(true).name;
  }

  public get focusedValue(): string {
    return String(this.interaction.options.getFocused());
  }

  public getGuildRoles(): readonly { id: string; name: string; color: number }[] {
    const roles = this.interaction.guild?.roles.cache.values();
    if (roles === undefined) return [];
    return [...roles].map((role) => ({ id: role.id, name: role.name, color: role.color }));
  }

  public async respond(choices: Array<{ name: string; value: string }>): Promise<void> {
    await this.interaction.respond(choices);
  }
}

export class DiscordButtonAdapter implements OfferButtonInteraction, ButtonInteractionAdapter {
  public constructor(
    private readonly interaction: ButtonInteraction,
    private readonly logger: Logger,
  ) {}

  public get customId(): string {
    return this.interaction.customId;
  }

  public get userId(): string {
    return this.interaction.user.id;
  }

  public get userDisplayName(): string {
    return invokingUserDisplayName(this.interaction);
  }

  public get guildId(): string | undefined {
    return this.interaction.guildId ?? undefined;
  }

  public get channelId(): string {
    return this.interaction.channelId;
  }

  public get messageId(): string {
    return this.interaction.message.id;
  }

  public get replied(): boolean {
    return this.interaction.replied;
  }

  public get deferred(): boolean {
    return this.interaction.deferred;
  }

  public async reply(response: SafeInteractionResponse): Promise<void> {
    await this.interaction.reply(response);
  }

  public get guildName(): string | undefined {
    return this.interaction.guild?.name;
  }

  public get guildIconUrl(): string | undefined {
    return this.interaction.guild?.iconURL() ?? undefined;
  }

  public get guildOwnerId(): string | undefined {
    return this.interaction.guild?.ownerId;
  }

  public get memberRoleIds(): readonly string[] {
    const roles = this.interaction.member?.roles;
    if (roles === undefined) return [];
    return Array.isArray(roles) ? roles : [...roles.cache.keys()];
  }

  public get hasAdministratorPermission(): boolean {
    return (
      this.interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) ?? false
    );
  }

  public getGuildRoleMetadata(roleId: string): {
    id: string;
    name: string;
    color: number;
  } | null {
    const role = this.interaction.guild?.roles.cache.get(roleId);
    return role === undefined ? null : { id: role.id, name: role.name, color: role.color };
  }

  public getGuildMemberDisplayName(userId: string): string | null {
    if (this.interaction.user.id === userId) {
      const member = this.interaction.member;
      if (
        member &&
        typeof member === 'object' &&
        'displayName' in member &&
        typeof member.displayName === 'string'
      ) {
        return (
          member.displayName.trim() ||
          this.interaction.user.globalName ||
          this.interaction.user.username
        );
      }
      return this.interaction.user.globalName || this.interaction.user.username;
    }
    const member = this.interaction.guild?.members.cache.get(userId);
    if (member) {
      return member.displayName.trim() || member.user.globalName || member.user.username;
    }
    const user = this.interaction.client.users.cache.get(userId);
    return user ? user.globalName || user.username : null;
  }

  public async resolveGuildMemberDisplayName(userId: string): Promise<string | null> {
    return resolveGuildMemberDisplayName(this.interaction, this.logger, userId);
  }

  public async resolveGuildRoleMetadata(roleId: string): Promise<{
    id: string;
    name: string;
    color: number;
  } | null> {
    return resolveGuildRoleMetadata(this.interaction, this.logger, roleId);
  }

  public async deferUpdate(): Promise<void> {
    await this.interaction.deferUpdate();
  }

  public async deferReply(response?: DeferredInteractionResponse): Promise<void> {
    await this.interaction.deferReply(response);
  }

  public async editReply(response: EditedInteractionResponse): Promise<void> {
    await this.interaction.editReply(response);
  }

  public async followUp(response: SafeInteractionResponse): Promise<void> {
    await this.interaction.followUp(response);
  }
}

export function createInteractionCreateHandler(
  registry: CommandRegistry,
  context: CommandContext,
  logger: Logger,
): (interaction: Interaction) => Promise<void> {
  return async (interaction) => {
    if (interaction.isChatInputCommand()) {
      await handleInteractionCreate(
        new DiscordCommandInteraction(interaction, logger),
        registry,
        context,
        logger,
      );
      return;
    }
    if (interaction.isAutocomplete()) {
      const adapted = new DiscordAutocomplete(interaction);
      const command = registry.resolve(adapted.commandName);
      if (command?.autocomplete === undefined) {
        await adapted.respond([]);
        return;
      }
      try {
        await command.autocomplete(adapted, context);
      } catch (error: unknown) {
        logger.error('command autocomplete failed', error, { commandName: adapted.commandName });
        await adapted.respond([]).catch(() => undefined);
      }
      return;
    }
    if (interaction.isButton()) {
      const adapted = new DiscordButtonAdapter(interaction, logger);
      const isDeparture = context.departureCommandHandler?.canHandle(adapted.customId) ?? false;
      const isPromotionDemotion =
        context.promotionDemotionCommandHandler?.canHandle(adapted.customId) ?? false;
      const isTeamDisbandment =
        context.teamDisbandmentCommandHandler?.canHandle(adapted.customId) ?? false;
      const isTeamSwap = context.teamSwapCommandHandler?.canHandle(adapted.customId) ?? false;
      try {
        if (isDeparture) {
          await context.departureCommandHandler!.handleButton(adapted);
        } else if (isPromotionDemotion) {
          await context.promotionDemotionCommandHandler!.handleButton(adapted);
        } else if (isTeamDisbandment) {
          await context.teamDisbandmentCommandHandler!.handleButton(adapted);
        } else if (isTeamSwap) {
          await context.teamSwapCommandHandler!.handleButton(adapted);
        } else {
          await context.offerButtonHandler.handle(adapted);
        }
      } catch (error: unknown) {
        logger.error('button interaction failed', error, { customId: adapted.customId });
        const mapped = mapDiscordError(error);
        const response = {
          embeds: [mapped.embed],
          flags: MessageFlags.Ephemeral,
        } as const;
        if (adapted.deferred && !adapted.replied) {
          await adapted.editReply({
            embeds: [mapped.embed],
            ...(isDeparture || isPromotionDemotion || isTeamDisbandment || isTeamSwap
              ? { components: [] }
              : {}),
          });
        } else if (adapted.replied) {
          await adapted.followUp(response);
        } else {
          await adapted.reply(response);
        }
      }
    }
  };
}
