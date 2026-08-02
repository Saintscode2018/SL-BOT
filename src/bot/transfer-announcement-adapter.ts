import type { Client } from 'discord.js';

import { TransferAnnouncementDeliveryError } from '../domain/errors.js';
import type { TransferAnnouncementPlan } from '../domain/roster-mutation.js';
import { formatTeamIdentity } from '../domain/team-label.js';
import type { TransferAnnouncementAdapter } from '../services/transfer-announcement-service.js';
import { getTeamThumbnail } from './emoji-helper.js';
import { createInfoEmbed } from './embeds.js';
import {
  BOT_COLORS,
  BOT_EMOJIS,
  BOT_LABELS,
  createActorFooter,
  createGuildAuthor,
  createPlayerFooter,
  formatTeamPlainRoleName,
  resolveTeamRoleColor,
} from './presentation/index.js';

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
    const teamRoleName = formatTeamPlainRoleName({
      emoji: plan.teamIdentity.emoji,
      discordRoleId: plan.teamIdentity.discordRoleId,
      discordRoleName: plan.presentation?.teamRoleName,
    });
    const member = `<@${plan.discordUserId}>`;
    const team = formatTeamIdentity(plan.teamIdentity, 'message');
    const thumbnail = getTeamThumbnail(plan.teamIdentity.emoji);
    const actorMention =
      plan.actorDiscordUserId === undefined ? 'an administrator' : `<@${plan.actorDiscordUserId}>`;
    const actorUsername = plan.presentation?.actor?.username.trim() || 'Unknown User';
    const actorAvatarUrl = plan.presentation?.actor?.avatarUrl ?? null;
    const author = createGuildAuthor({ guildName: serverName, guildIconUrl: serverIconUrl });

    const embed =
      plan.type === 'APPOINTED' || plan.type === 'DEMOTED'
        ? (() => {
            const footer = createActorFooter({
              verb: plan.type === 'APPOINTED' ? 'Appointed' : 'Demoted',
              username: actorUsername,
              avatarUrl: actorAvatarUrl,
              timestamp: plan.occurredAt,
            });
            return createInfoEmbed({
              author,
              title: `${teamRoleName} Transaction (${plan.type === 'APPOINTED' ? BOT_LABELS.appointment : BOT_LABELS.demotion})`,
              color: resolveTeamRoleColor(roleColor, BOT_COLORS.info),
              fields: [
                {
                  name: plan.type === 'APPOINTED' ? BOT_LABELS.appointment : BOT_LABELS.demotion,
                  value:
                    plan.type === 'APPOINTED'
                      ? `${member} has been appointed as ${plan.staffRoleId === undefined ? (plan.staffRole ?? 'staff') : `<@&${plan.staffRoleId}>`} for ${team} by ${actorMention}!`
                      : `${member} has been demoted to player for ${team} by ${actorMention}!`,
                  inline: false,
                },
              ],
              thumbnail,
              footer: footer.text,
              ...(footer.iconURL ? { footerIconURL: footer.iconURL } : {}),
            });
          })()
        : plan.type === 'SIGNED'
          ? (() => {
              const footer = createPlayerFooter({
                username: plan.presentation?.subject?.username || 'Unknown Player',
                avatarUrl: plan.presentation?.subject?.avatarUrl ?? null,
                timestamp: plan.occurredAt,
              });
              return createInfoEmbed({
                author,
                title: `${BOT_EMOJIS.success} ${BOT_LABELS.offerAccepted} - ${teamRoleName}`,
                description: `${member} has accepted the offer from ${team}\n\n${BOT_EMOJIS.roster} ${BOT_LABELS.roster}: ${plan.roster?.currentSize ?? 0}/${plan.roster?.maximumSize ?? 0}\n\n${BOT_EMOJIS.teamManager} ${BOT_LABELS.teamManager}: ${plan.roster?.teamManagerDiscordUserId ? `<@${plan.roster.teamManagerDiscordUserId}>` : BOT_LABELS.vacant}`,
                color: resolveTeamRoleColor(roleColor, BOT_COLORS.info),
                thumbnail,
                footer: footer.text,
                ...(footer.iconURL ? { footerIconURL: footer.iconURL } : {}),
              });
            })()
          : createInfoEmbed({
              description: announcementDescription(plan),
              color: resolveTeamRoleColor(roleColor, BOT_COLORS.info),
            });
    await channel
      .send({ allowedMentions: { parse: [] }, embeds: [embed] })
      .catch((error: unknown) => {
        throw new TransferAnnouncementDeliveryError({ cause: error });
      });
  }
}
