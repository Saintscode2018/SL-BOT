import {
  MessageFlags,
  PermissionsBitField,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
} from 'discord.js';

import type { Logger } from '../logging/logger.js';
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
  DeferredInteractionResponse,
  EditedInteractionResponse,
  SafeInteractionResponse,
} from './types.js';

class DiscordCommandOptions implements CommandInteractionOptions {
  public constructor(private readonly interaction: ChatInputCommandInteraction) {}

  public getSubcommand(): string | null {
    try {
      return this.interaction.options.getSubcommand();
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

  public getUser(name: string): { id: string; bot: boolean } | null {
    const user = this.interaction.options.getUser(name);
    return user === null ? null : { id: user.id, bot: user.bot };
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

class DiscordCommandInteraction implements CommandInteraction {
  public constructor(private readonly interaction: ChatInputCommandInteraction) {}

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

  public async executeDebugReset(database: CommandContext['database']): Promise<void> {
    await sendDebugResetPrompt(this.interaction, database);
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

class DiscordOfferButton implements OfferButtonInteraction {
  public constructor(private readonly interaction: ButtonInteraction) {}

  public get customId(): string {
    return this.interaction.customId;
  }

  public get userId(): string {
    return this.interaction.user.id;
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
        new DiscordCommandInteraction(interaction),
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
      const adapted = new DiscordOfferButton(interaction);
      try {
        await context.offerButtonHandler.handle(adapted);
      } catch (error: unknown) {
        logger.error('button interaction failed', error, { customId: adapted.customId });
        const mapped = mapDiscordError(error);
        const response = {
          embeds: [mapped.embed],
          flags: MessageFlags.Ephemeral,
        } as const;
        if (adapted.deferred && !adapted.replied) {
          await adapted.editReply({ embeds: [mapped.embed] });
        } else if (adapted.replied) {
          await adapted.followUp(response);
        } else {
          await adapted.reply(response);
        }
      }
    }
  };
}
