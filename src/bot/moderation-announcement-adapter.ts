import type { Client } from 'discord.js';

import { ModerationAnnouncementDeliveryError } from '../domain/errors.js';
import { formatModerationDuration } from '../domain/moderation-duration.js';
import type {
  ModerationAnnouncementAdapter,
  ModerationAnnouncementPlan,
} from '../services/moderation-announcement-service.js';
import { createSuccessEmbed } from './embeds.js';
import {
  createActorFooter,
  createGuildAuthor,
  formatUserWithVisibleName,
} from './presentation/index.js';

export class DiscordModerationAnnouncementAdapter implements ModerationAnnouncementAdapter {
  public constructor(private readonly client: Client) {}

  public async send(plan: ModerationAnnouncementPlan, channelId: string): Promise<void> {
    const channel = await this.client.channels.fetch(channelId).catch((error: unknown) => {
      throw new ModerationAnnouncementDeliveryError({ cause: error });
    });
    if (
      channel === null ||
      !channel.isSendable() ||
      !('guildId' in channel) ||
      channel.guildId !== plan.discordGuildId
    ) {
      throw new ModerationAnnouncementDeliveryError();
    }

    const targetName = plan.presentation?.target?.username ?? 'Unknown User';
    const actorName = plan.presentation?.actor?.username ?? 'Unknown User';
    const footer = createActorFooter({
      verb: plan.operation === 'MUTE' ? 'Muted' : 'Unmuted',
      username: actorName,
      avatarUrl: plan.presentation?.actor?.avatarUrl,
      timestamp: plan.occurredAt,
    });
    const fields = [
      {
        name: 'User',
        value: formatUserWithVisibleName(plan.targetDiscordUserId, targetName),
        inline: false,
      },
      { name: 'Reason', value: plan.reason ?? 'No reason given', inline: false },
    ];
    if (plan.operation === 'MUTE') {
      fields.push(
        {
          name: 'Punishment',
          value: formatModerationDuration(plan.durationSeconds!),
          inline: false,
        },
        { name: 'Bail', value: String(plan.bail), inline: false },
      );
    }
    const embed = createSuccessEmbed({
      title: `${plan.operation === 'MUTE' ? 'Mute' : 'Unmute'} • Case #${plan.caseNumber}`,
      author: createGuildAuthor({
        guildName: plan.presentation?.serverName ?? 'Discord Server',
        guildIconUrl: plan.presentation?.serverIconUrl,
      }),
      fields,
      footer: footer.text,
      ...(footer.iconURL ? { footerIconURL: footer.iconURL } : {}),
    });

    await channel
      .send({ allowedMentions: { parse: [] }, embeds: [embed] })
      .catch((error: unknown) => {
        throw new ModerationAnnouncementDeliveryError({ cause: error });
      });
  }
}
