import type { Client } from 'discord.js';

import { AuditAnnouncementDeliveryError } from '../domain/errors.js';
import type { AuditAnnouncementPlan } from '../domain/roster-mutation.js';
import { formatTeamIdentity } from '../domain/team-label.js';
import type { AuditAnnouncementAdapter } from '../services/audit-announcement-service.js';
import { getTeamThumbnail } from './emoji-helper.js';
import { createActorField, createSuccessEmbed } from './embeds.js';
import {
  BOT_COLORS,
  BOT_EMOJIS,
  createGuildAuthor,
  formatUserWithVisibleName,
  resolveTeamRoleColor,
} from './presentation/index.js';

export class DiscordAuditAnnouncementAdapter implements AuditAnnouncementAdapter {
  public constructor(private readonly client: Client) {}

  public async send(plan: AuditAnnouncementPlan): Promise<void> {
    const channel = await this.client.channels.fetch(plan.channelId).catch((error: unknown) => {
      throw new AuditAnnouncementDeliveryError({ cause: error });
    });
    if (
      channel === null ||
      !channel.isSendable() ||
      !('guildId' in channel) ||
      channel.guildId !== plan.discordGuildId
    ) {
      throw new AuditAnnouncementDeliveryError();
    }

    const roleColor = plan.presentation?.teamRoleColor;
    const serverName = plan.presentation?.serverName.trim() || 'Discord Server';
    const serverIconUrl = plan.presentation?.serverIconUrl ?? null;
    const subjectName = plan.presentation?.subject?.username || 'Unknown User';
    const actorName = plan.presentation?.actor?.username || 'Unknown User';

    const playerFormatted = formatUserWithVisibleName(plan.playerDiscordUserId, subjectName);
    const teamFormatted = formatTeamIdentity(plan.teamIdentity, 'message');
    const thumbnail = getTeamThumbnail(plan.teamIdentity.emoji);
    const author = createGuildAuthor({ guildName: serverName, guildIconUrl: serverIconUrl });

    const isAdd = plan.operation === 'ROSTER_PLAYER_ADDED';
    const title = isAdd
      ? `${BOT_EMOJIS.success} Player Added to Roster`
      : `${BOT_EMOJIS.success} Player Removed from Roster`;
    const description = isAdd
      ? `${playerFormatted} was added to ${teamFormatted}.`
      : `${playerFormatted} was removed from ${teamFormatted}.`;

    const actorField = createActorField(
      isAdd ? 'Added' : 'Removed',
      plan.actorDiscordUserId,
      actorName,
    );

    const embed = createSuccessEmbed({
      title,
      description,
      author,
      color: resolveTeamRoleColor(roleColor, BOT_COLORS.success),
      thumbnail,
      fields: [actorField],
      timestamp: plan.occurredAt,
    });

    await channel
      .send({ allowedMentions: { parse: [] }, embeds: [embed] })
      .catch((error: unknown) => {
        throw new AuditAnnouncementDeliveryError({ cause: error });
      });
  }
}
