import { SlashCommandBuilder } from 'discord.js';

import { ConfigurationError } from '../domain/errors.js';
import type { CommandDefinition } from './types.js';

export const muteCommand: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Apply a Discord timeout and open a moderation case')
    .addUserOption((option) =>
      option.setName('user').setDescription('Member to mute').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('duration')
        .setDescription('Duration such as 30s, 10m, 2h30m, or 1d')
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('bail')
        .setDescription('Bail amount for this punishment')
        .setMinValue(0)
        .setMaxValue(2_147_483_647)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('Reason for the mute').setMaxLength(1000),
    ),
  async execute(interaction, context) {
    if (context.moderationCommandHandler === undefined) {
      throw new ConfigurationError('moderation command support is unavailable');
    }
    await context.moderationCommandHandler.mute(interaction);
  },
};

export const unmuteCommand: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Remove a Discord timeout and resolve its moderation case')
    .addUserOption((option) =>
      option.setName('user').setDescription('Member to unmute').setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('Reason for removing the mute').setMaxLength(1000),
    ),
  async execute(interaction, context) {
    if (context.moderationCommandHandler === undefined) {
      throw new ConfigurationError('moderation command support is unavailable');
    }
    await context.moderationCommandHandler.unmute(interaction);
  },
};
