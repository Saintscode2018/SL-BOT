import type { APIEmbedField, Client } from 'discord.js';

import { AuditAnnouncementDeliveryError } from '../domain/errors.js';
import type { AuditAnnouncementPlan, StaffRoleCode } from '../domain/roster-mutation.js';
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

function getRolePositionName(staffRole?: StaffRoleCode): string {
  switch (staffRole) {
    case 'TM':
      return 'Team Manager';
    case 'ATM':
      return 'Assistant Team Manager';
    case 'PM':
      return 'Player Manager';
    default:
      return 'staff';
  }
}

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

    const presentation = 'presentation' in plan ? plan.presentation : undefined;
    const roleColor = presentation?.teamRoleColor;
    const serverName = presentation?.serverName.trim() || 'Discord Server';
    const serverIconUrl = presentation?.serverIconUrl ?? null;
    const subjectName = presentation?.subject?.username || 'Unknown User';
    const actorName = presentation?.actor?.username || 'Unknown User';

    const playerFormatted =
      plan.operation === 'TEAM_DISBANDED'
        ? ''
        : formatUserWithVisibleName(plan.playerDiscordUserId, subjectName);
    const teamFormatted = formatTeamIdentity(plan.teamIdentity, 'message');
    const thumbnail = getTeamThumbnail(plan.teamIdentity.emoji);
    const author = createGuildAuthor({ guildName: serverName, guildIconUrl: serverIconUrl });

    let title: string;
    let description: string;
    const fields: APIEmbedField[] = [];

    const positionName =
      'staffRole' in plan && plan.staffRole !== undefined
        ? getRolePositionName(plan.staffRole)
        : '';

    switch (plan.operation) {
      case 'ROSTER_PLAYER_ADDED':
        title = `${BOT_EMOJIS.success} Player Added to Roster`;
        description = `${playerFormatted} was added to ${teamFormatted}.`;
        fields.push(createActorField('Added', plan.actorDiscordUserId, actorName));
        break;
      case 'ROSTER_PLAYER_REMOVED':
        title = `${BOT_EMOJIS.success} Player Removed from Roster`;
        description = `${playerFormatted} was removed from ${teamFormatted}.`;
        fields.push(createActorField('Removed', plan.actorDiscordUserId, actorName));
        break;
      case 'STAFF_APPOINTED':
        title = `${BOT_EMOJIS.success} Staff Member Appointed`;
        description = `${playerFormatted} was appointed as ${positionName} of ${teamFormatted}.`;
        fields.push(createActorField('Appointed', plan.actorDiscordUserId, actorName));
        break;
      case 'STAFF_REMOVED':
        title = `${BOT_EMOJIS.success} Staff Member Removed`;
        description = `${playerFormatted} was removed as ${positionName} of ${teamFormatted}.`;
        fields.push(createActorField('Removed', plan.actorDiscordUserId, actorName));
        break;
      case 'ROSTER_DEMANDED':
        title =
          plan.departureMode === 'STAFF_ONLY'
            ? `${BOT_EMOJIS.success} Staff Departure (Demand)`
            : `${BOT_EMOJIS.success} Roster Departure (Demand)`;
        description =
          plan.departureMode === 'STAFF_ONLY'
            ? `${playerFormatted} stepped down from staff for ${teamFormatted}.`
            : `${playerFormatted} demanded release from ${teamFormatted}.`;
        fields.push(createActorField('Demanded', plan.actorDiscordUserId, actorName));
        break;
      case 'ROSTER_RELEASED':
        title = `${BOT_EMOJIS.success} Player Released`;
        description = `${playerFormatted} was released from ${teamFormatted}.`;
        fields.push(createActorField('Released', plan.actorDiscordUserId, actorName));
        break;
      case 'ROSTER_PROMOTED':
        title = `${BOT_EMOJIS.success} Player Promoted`;
        description = `${playerFormatted} was promoted to ${positionName} for ${teamFormatted}.`;
        fields.push(createActorField('Promoted', plan.actorDiscordUserId, actorName));
        break;
      case 'ROSTER_DEMOTED':
        title = `${BOT_EMOJIS.success} Staff Member Demoted`;
        description = `${playerFormatted} was demoted to player for ${teamFormatted}.`;
        fields.push(createActorField('Demoted', plan.actorDiscordUserId, actorName));
        break;
      case 'TEAM_DISBANDED':
        title = `${BOT_EMOJIS.success} Team Disbanded`;
        description = [
          `${teamFormatted} was disbanded.`,
          '',
          `> Staff and player memberships ended: **${plan.disbandDetails?.endedMembershipCount ?? 0}**`,
          `> Members moved to free agency: **${plan.disbandDetails?.affectedUserCount ?? 0}**`,
          `> Outstanding offers expired: **${plan.disbandDetails?.expiredOfferCount ?? 0}**`,
        ].join('\n');
        fields.push(createActorField('Disbanded', plan.actorDiscordUserId, actorName));
        break;
      case 'OFFER_CREATED':
        title = `${BOT_EMOJIS.success} Contract Offer Created`;
        description = `A contract offer for ${teamFormatted} was created for ${playerFormatted}.`;
        fields.push(createActorField('Created', plan.actorDiscordUserId, actorName));
        if (plan.expiresAt) {
          const epoch = Math.floor(plan.expiresAt.getTime() / 1000);
          fields.push({
            name: 'Expires',
            value: `<t:${epoch}:R> (<t:${epoch}:f>)`,
            inline: false,
          });
        }
        break;
      case 'OFFER_DECLINED':
        title = `${BOT_EMOJIS.success} Offer Declined`;
        description = `${playerFormatted} declined the contract offer from ${teamFormatted}.`;
        fields.push(createActorField('Declined', plan.actorDiscordUserId, actorName));
        break;
      case 'OFFER_EXPIRED':
        title = `${BOT_EMOJIS.success} Offer Expired`;
        description = `The contract offer to ${playerFormatted} from ${teamFormatted} has expired.`;
        fields.push({
          name: 'Expired by',
          value: 'System (Automatic Expiration)',
          inline: false,
        });
        break;
    }

    const embed = createSuccessEmbed({
      title,
      description,
      author,
      color: resolveTeamRoleColor(roleColor, BOT_COLORS.success),
      thumbnail,
      fields,
      timestamp: plan.occurredAt,
    });

    await channel
      .send({ allowedMentions: { parse: [] }, embeds: [embed] })
      .catch((error: unknown) => {
        throw new AuditAnnouncementDeliveryError({ cause: error });
      });
  }
}
