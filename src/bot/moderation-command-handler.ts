import { MessageFlags } from 'discord.js';

import { BotUserNotAllowedError } from '../domain/errors.js';
import {
  formatModerationDuration,
  parseModerationDuration,
} from '../domain/moderation-duration.js';
import type { CommandChannelPolicyService } from '../services/command-channel-policy-service.js';
import type { ModerationMuteService } from '../services/moderation-mute-service.js';
import { createSuccessEmbed } from './embeds.js';
import { requireGuildExecution } from './guild-execution.js';
import { requireInteger, requireString, requireUser } from './option-parsing.js';
import { BOT_EMOJIS, formatUserWithVisibleName, getUserDisplayName } from './presentation/index.js';
import type { CommandInteraction } from './types.js';

export type ModerationCommandClock = () => Date;

function deliveryWarning(caseFilesDelivered: boolean, auditDelivered: boolean): string | null {
  if (!caseFilesDelivered && !auditDelivered) {
    return `${BOT_EMOJIS.warning} The moderation action succeeded, but the Case Files and Audit messages could not be delivered.`;
  }
  if (!caseFilesDelivered) {
    return `${BOT_EMOJIS.warning} The moderation action succeeded, but the Case Files message could not be delivered.`;
  }
  if (!auditDelivered) {
    return `${BOT_EMOJIS.warning} The moderation action succeeded, but the Audit message could not be delivered.`;
  }
  return null;
}

export class ModerationCommandHandler {
  public constructor(
    private readonly channelPolicy: Pick<CommandChannelPolicyService, 'validateChannelPolicy'>,
    private readonly moderation: Pick<ModerationMuteService, 'mute' | 'unmute'>,
    private readonly now: ModerationCommandClock = () => new Date(),
  ) {}

  public async mute(interaction: CommandInteraction): Promise<void> {
    const execution = requireGuildExecution(interaction, { requireChannel: true });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await this.channelPolicy.validateChannelPolicy({
      authorization: execution.authorization,
      channelId: execution.channelId,
      commandName: 'mute',
      subcommand: null,
    });
    const target = requireUser(execution.options, 'user');
    if (target.bot) throw new BotUserNotAllowedError('bots cannot be muted');
    const durationSeconds = parseModerationDuration(requireString(execution.options, 'duration'));
    const reason = execution.options.getString('reason');
    const result = await this.moderation.mute({
      authorization: execution.authorization,
      targetDiscordUserId: target.id,
      durationSeconds,
      reason,
      bail: requireInteger(execution.options, 'bail'),
      issuedAt: this.now(),
    });
    const targetName = getUserDisplayName(interaction, target.id, target.displayName);
    const warning = deliveryWarning(result.caseFilesDelivered, result.auditDelivered);
    const description = [
      `${formatUserWithVisibleName(target.id, targetName)} was muted for **${formatModerationDuration(durationSeconds)}**.`,
      warning,
    ]
      .filter((line): line is string => line !== null)
      .join('\n\n');
    await interaction.editReply({
      embeds: [
        createSuccessEmbed({
          title: `${BOT_EMOJIS.success} Mute Applied`,
          description,
        }),
      ],
    });
  }

  public async unmute(interaction: CommandInteraction): Promise<void> {
    const execution = requireGuildExecution(interaction, { requireChannel: true });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await this.channelPolicy.validateChannelPolicy({
      authorization: execution.authorization,
      channelId: execution.channelId,
      commandName: 'unmute',
      subcommand: null,
    });
    const target = requireUser(execution.options, 'user');
    if (target.bot) throw new BotUserNotAllowedError('bots cannot be unmuted');
    const result = await this.moderation.unmute({
      authorization: execution.authorization,
      targetDiscordUserId: target.id,
      reason: execution.options.getString('reason'),
      resolvedAt: this.now(),
    });
    const targetName = getUserDisplayName(interaction, target.id, target.displayName);
    const warning = deliveryWarning(result.caseFilesDelivered, result.auditDelivered);
    const description = [
      `${formatUserWithVisibleName(target.id, targetName)} was unmuted.`,
      warning,
    ]
      .filter((line): line is string => line !== null)
      .join('\n\n');
    await interaction.editReply({
      embeds: [
        createSuccessEmbed({
          title: `${BOT_EMOJIS.success} Mute Removed`,
          description,
        }),
      ],
    });
  }
}
