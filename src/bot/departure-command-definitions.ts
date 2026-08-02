import { SlashCommandBuilder } from 'discord.js';

import { ConfigurationError } from '../domain/errors.js';
import type { CommandDefinition } from './types.js';

export const demandCommand: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('demand')
    .setDescription('Leave your staff position or team'),
  async execute(interaction, context) {
    if (context.departureCommandHandler === undefined) {
      throw new ConfigurationError('departure command support is unavailable');
    }
    await context.departureCommandHandler.beginDemand(interaction);
  },
};

export const releaseCommand: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('release')
    .setDescription('Release a player from your team')
    .addUserOption((option) =>
      option.setName('player').setDescription('Player to release').setRequired(true),
    ),
  async execute(interaction, context) {
    if (context.departureCommandHandler === undefined) {
      throw new ConfigurationError('departure command support is unavailable');
    }
    await context.departureCommandHandler.beginRelease(interaction);
  },
};
