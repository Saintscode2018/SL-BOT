import type { Client } from 'discord.js';

import { TransferAnnouncementDeliveryError } from '../domain/errors.js';
import type { TransferAnnouncementPlan } from '../domain/roster-mutation.js';
import { formatTeamIdentity } from '../domain/team-label.js';
import type { TransferAnnouncementAdapter } from '../services/transfer-announcement-service.js';
import { getTeamThumbnail } from './emoji-helper.js';
import { createInfoEmbed, EMBED_COLORS } from './embeds.js';
import { resolveTeamRoleColor } from './team-presentation.js';

function readableTeamRoleName(plan: TransferAnnouncementPlan): string {
  const roleName = plan.presentation?.teamRoleName?.trim().replace(/^@+/u, '');
  return roleName || 'Team';
}

function utcTimestamp(timestamp: Date): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = new Map(
    formatter
      .formatToParts(timestamp)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.get('day')}.${parts.get('month')}.${parts.get('year')} ${parts.get('hour')}:${parts.get('minute')} UTC`;
}

function announcementDescription(plan: TransferAnnouncementPlan): string {
  const member = `<@${plan.discordUserId}>`;
  const team = formatTeamIdentity(plan.teamIdentity, 'message');
  switch (plan.type) {
    case 'SIGNED':
      return `${member} has signed for ${team}!`;
    case 'DEMANDED':
      return `${member} has demanded from ${team}!`;
    case 'RELEASED':
      return `${member} has been released from ${team}!`;
    case 'PROMOTED':
      return `${member} has been promoted to ${plan.staffRole ?? 'staff'} for ${team}!`;
    case 'DEMOTED':
      return `${member} has been demoted to player for ${team}!`;
    case 'APPOINTED':
      return `${member} has been appointed as ${plan.staffRole ?? 'staff'} for ${team}!`;
  }
}

export class DiscordTransferAnnouncementAdapter implements TransferAnnouncementAdapter {
  public constructor(private readonly client: Client) {}

  public async send(plan: TransferAnnouncementPlan): Promise<void> {
    const channel = await this.client.channels.fetch(plan.channelId).catch((error: unknown) => {
      throw new TransferAnnouncementDeliveryError({ cause: error });
    });
    if (
      channel === null ||
      !channel.isSendable() ||
      !('guildId' in channel) ||
      channel.guildId !== plan.discordGuildId
    ) {
      throw new TransferAnnouncementDeliveryError();
    }

    const roleColor = plan.presentation?.teamRoleColor;
    const serverName = plan.presentation?.serverName.trim() || 'Discord Server';
    const serverIconUrl = plan.presentation?.serverIconUrl ?? null;
    const teamRoleName = readableTeamRoleName(plan);
    const member = `<@${plan.discordUserId}>`;
    const team = formatTeamIdentity(plan.teamIdentity, 'message');
    const thumbnail = getTeamThumbnail(plan.teamIdentity.emoji);
    const actorMention =
      plan.actorDiscordUserId === undefined ? 'an administrator' : `<@${plan.actorDiscordUserId}>`;
    const actorUsername = plan.presentation?.actor?.username.trim() || 'Unknown User';
    const actorAvatarUrl = plan.presentation?.actor?.avatarUrl ?? null;
    const timestamp = utcTimestamp(plan.occurredAt);

    const embed =
      plan.type === 'APPOINTED' || plan.type === 'DEMOTED'
        ? createInfoEmbed({
            author: {
              name: serverName,
              ...(serverIconUrl === null ? {} : { iconURL: serverIconUrl }),
            },
            title: `${teamRoleName} Transaction (${plan.type === 'APPOINTED' ? 'Appointment' : 'Demotion'})`,
            color: resolveTeamRoleColor(roleColor, EMBED_COLORS.INFO),
            fields: [
              {
                name: plan.type === 'APPOINTED' ? 'Appointment' : 'Demotion',
                value:
                  plan.type === 'APPOINTED'
                    ? `${member} has been appointed as ${plan.staffRoleId === undefined ? (plan.staffRole ?? 'staff') : `<@&${plan.staffRoleId}>`} for ${team} by ${actorMention}!`
                    : `${member} has been demoted to player for ${team} by ${actorMention}!`,
                inline: false,
              },
            ],
            thumbnail,
            footer: `${plan.type === 'APPOINTED' ? 'Appointed' : 'Demoted'} by ${actorUsername} • ${timestamp}`,
            footerIconURL: actorAvatarUrl,
          })
        : plan.type === 'SIGNED'
          ? createInfoEmbed({
              author: {
                name: serverName,
                ...(serverIconUrl === null ? {} : { iconURL: serverIconUrl }),
              },
              title: `✅ Offer Accepted - ${teamRoleName}`,
              description: `${member} has accepted the offer from ${team}\n\n📁 Roster: ${plan.roster?.currentSize ?? 0}/${plan.roster?.maximumSize ?? 0}\n\n💼 Team Manager: ${plan.roster?.teamManagerDiscordUserId ? `<@${plan.roster.teamManagerDiscordUserId}>` : 'Vacant'}`,
              color: resolveTeamRoleColor(roleColor, EMBED_COLORS.INFO),
              thumbnail,
              footer: `Player: ${plan.presentation?.subject?.username.trim() || 'Unknown Player'} • ${timestamp}`,
              footerIconURL: plan.presentation?.subject?.avatarUrl ?? null,
            })
          : createInfoEmbed({
              description: announcementDescription(plan),
              color: resolveTeamRoleColor(roleColor, EMBED_COLORS.INFO),
            });
    await channel
      .send({ allowedMentions: { parse: [] }, embeds: [embed] })
      .catch((error: unknown) => {
        throw new TransferAnnouncementDeliveryError({ cause: error });
      });
  }
}
