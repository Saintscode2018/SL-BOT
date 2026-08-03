import { SlashCommandBuilder } from 'discord.js';

import { ConfigurationError } from '../domain/errors.js';
import type { CommandDefinition } from './types.js';

export const promoteCommand: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('promote')
    .setDescription('Promote a team member to a staff position')
    .addUserOption((option) =>
      option.setName('player').setDescription('Player to promote').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('rank')
        .setDescription('Staff rank to promote to')
        .setRequired(true)
        .addChoices(
          { name: 'Assistant Team Manager', value: 'ATM' },
          { name: 'Player Manager', value: 'PM' },
        ),
    ),
  async execute(interaction, context) {
    if (context.promotionDemotionCommandHandler === undefined) {
      throw new ConfigurationError('promotion/demotion command support is unavailable');
    }
    await context.promotionDemotionCommandHandler.beginPromote(interaction);
  },
};

export const demoteCommand: CommandDefinition = {
  data: new SlashCommandBuilder()
    .setName('demote')
    .setDescription('Demote a team staff member to player')
    .addUserOption((option) =>
      option.setName('staff').setDescription('Staff member to demote').setRequired(true),
    ),
  async execute(interaction, context) {
    if (context.promotionDemotionCommandHandler === undefined) {
      throw new ConfigurationError('promotion/demotion command support is unavailable');
    }
    await context.promotionDemotionCommandHandler.beginDemote(interaction);
  },
};
