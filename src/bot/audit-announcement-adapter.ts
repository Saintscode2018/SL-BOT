import type { Client } from 'discord.js';

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

    const roleColor = plan.presentation?.teamRoleColor;
    const serverName = plan.presentation?.serverName.trim() || 'Discord Server';
    const serverIconUrl = plan.presentation?.serverIconUrl ?? null;
    const subjectName = plan.presentation?.subject?.username || 'Unknown User';
    const actorName = plan.presentation?.actor?.username || 'Unknown User';

    const playerFormatted = formatUserWithVisibleName(plan.playerDiscordUserId, subjectName);
    const teamFormatted = formatTeamIdentity(plan.teamIdentity, 'message');
    const thumbnail = getTeamThumbnail(plan.teamIdentity.emoji);
    const author = createGuildAuthor({ guildName: serverName, guildIconUrl: serverIconUrl });

    let title: string;
    let description: string;
    let verb: 'Added' | 'Removed' | 'Appointed' | 'Demanded' | 'Released' | 'Promoted' | 'Demoted';

    const positionName = getRolePositionName(plan.staffRole);

    switch (plan.operation) {
      case 'ROSTER_PLAYER_ADDED':
        title = `${BOT_EMOJIS.success} Player Added to Roster`;
        description = `${playerFormatted} was added to ${teamFormatted}.`;
        verb = 'Added';
        break;
      case 'ROSTER_PLAYER_REMOVED':
        title = `${BOT_EMOJIS.success} Player Removed from Roster`;
        description = `${playerFormatted} was removed from ${teamFormatted}.`;
        verb = 'Removed';
        break;
      case 'STAFF_APPOINTED':
        title = `${BOT_EMOJIS.success} Staff Member Appointed`;
        description = `${playerFormatted} was appointed as ${positionName} of ${teamFormatted}.`;
        verb = 'Appointed';
        break;
      case 'STAFF_REMOVED':
        title = `${BOT_EMOJIS.success} Staff Member Removed`;
        description = `${playerFormatted} was removed as ${positionName} of ${teamFormatted}.`;
        verb = 'Removed';
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
        verb = 'Demanded';
        break;
      case 'ROSTER_RELEASED':
        title = `${BOT_EMOJIS.success} Player Released`;
        description = `${playerFormatted} was released from ${teamFormatted}.`;
        verb = 'Released';
        break;
      case 'ROSTER_PROMOTED':
        title = `${BOT_EMOJIS.success} Player Promoted`;
        description = `${playerFormatted} was promoted to ${positionName} for ${teamFormatted}.`;
        verb = 'Promoted';
        break;
      case 'ROSTER_DEMOTED':
        title = `${BOT_EMOJIS.success} Staff Member Demoted`;
        description = `${playerFormatted} was demoted to player for ${teamFormatted}.`;
        verb = 'Demoted';
        break;
    }

    const actorField = createActorField(verb, plan.actorDiscordUserId, actorName);

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
