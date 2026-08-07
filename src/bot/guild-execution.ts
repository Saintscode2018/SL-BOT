import { ConfigurationError } from '../domain/errors.js';
import type { AuthorizationInput } from '../services/authorization-service.js';
import type { CommandInteraction, CommandInteractionOptions } from './types.js';

export interface GuildCommandExecution {
  guildId: string;
  guildName: string;
  channelId?: string;
  options: CommandInteractionOptions;
  authorization: AuthorizationInput;
}

export function extractAuthorizationInput(interaction: {
  guildId?: string | undefined;
  userId?: string | undefined;
  guildOwnerId?: string | undefined;
  memberRoleIds?: readonly string[] | undefined;
  hasAdministratorPermission?: boolean | undefined;
}): AuthorizationInput {
  return {
    discordGuildId: interaction.guildId!,
    discordUserId: interaction.userId!,
    guildOwnerId: interaction.guildOwnerId!,
    memberRoleIds: interaction.memberRoleIds ?? [],
    hasAdministratorPermission: interaction.hasAdministratorPermission ?? false,
  };
}

export function requireGuildExecution(
  interaction: CommandInteraction,
  options: { requireChannel: true },
): GuildCommandExecution & { channelId: string };
export function requireGuildExecution(
  interaction: CommandInteraction,
  options?: { requireChannel?: false },
): GuildCommandExecution;
export function requireGuildExecution(
  interaction: CommandInteraction,
  options?: { requireChannel?: boolean },
): GuildCommandExecution {
  const {
    guildId,
    guildName,
    guildOwnerId,
    userId,
    channelId,
    options: interactionOptions,
  } = interaction;

  if (options?.requireChannel) {
    if (
      guildId === undefined ||
      guildName === undefined ||
      guildOwnerId === undefined ||
      userId === undefined ||
      channelId === undefined ||
      interactionOptions === undefined
    ) {
      throw new ConfigurationError('this command must be used in a Discord server text channel');
    }
    return {
      guildId,
      guildName,
      channelId,
      options: interactionOptions,
      authorization: extractAuthorizationInput(interaction),
    };
  }

  if (
    guildId === undefined ||
    guildName === undefined ||
    guildOwnerId === undefined ||
    userId === undefined ||
    interactionOptions === undefined
  ) {
    throw new ConfigurationError('this command must be used in a Discord server');
  }

  return {
    guildId,
    guildName,
    ...(channelId === undefined ? {} : { channelId }),
    options: interactionOptions,
    authorization: extractAuthorizationInput(interaction),
  };
}
