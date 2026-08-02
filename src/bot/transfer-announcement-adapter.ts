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
  formatBlockquote,
  formatTeamPlainRoleName,
  formatUserWithVisibleName,
  resolveTeamRoleColor,
} from './presentation/index.js';

function announcementDescription(plan: TransferAnnouncementPlan): string {
  const subjectName = plan.presentation?.subject?.username || 'Unknown User';
  const member = formatUserWithVisibleName(plan.discordUserId, subjectName);
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
    const subjectName = plan.presentation?.subject?.username || 'Unknown User';
    const memberFormatted = formatUserWithVisibleName(plan.discordUserId, subjectName);
    const team = formatTeamIdentity(plan.teamIdentity, 'message');
    const thumbnail = getTeamThumbnail(plan.teamIdentity.emoji);

    const actorFormatted =
      plan.actorDiscordUserId === undefined
        ? 'an administrator'
        : formatUserWithVisibleName(
            plan.actorDiscordUserId,
            plan.presentation?.actor?.username || 'Unknown User',
          );
    const actorUsername = plan.presentation?.actor?.username.trim() || 'Unknown User';
    const actorAvatarUrl = plan.presentation?.actor?.avatarUrl ?? null;
    const author = createGuildAuthor({ guildName: serverName, guildIconUrl: serverIconUrl });

    const embed =
      plan.type === 'APPOINTED' || plan.type === 'DEMOTED'
        ? (() => {
            const isAppointed = plan.type === 'APPOINTED';
            const isStaffOnlyDemand =
              plan.type === 'DEMOTED' && plan.departureMode === 'STAFF_ONLY';
            const footer = createActorFooter({
              verb: isAppointed ? 'Appointed' : isStaffOnlyDemand ? 'Action' : 'Demoted',
              username: actorUsername,
              avatarUrl: actorAvatarUrl,
              timestamp: plan.occurredAt,
            });

            const staffRoleMention =
              plan.staffRoleId === undefined
                ? (plan.staffRole ?? 'staff')
                : `<@&${plan.staffRoleId}>`;

            const panelText = isAppointed
              ? `${memberFormatted} has been appointed as ${staffRoleMention} for ${team} by ${actorFormatted}!`
              : isStaffOnlyDemand
                ? `${memberFormatted} has stepped down to player for ${team}!`
                : `${memberFormatted} has been demoted to player for ${team} by ${actorFormatted}!`;

            return createInfoEmbed({
              author,
              title: `${teamRoleName} Transaction (${isAppointed ? BOT_LABELS.appointment : BOT_LABELS.demotion})`,
              color: resolveTeamRoleColor(roleColor, BOT_COLORS.info),
              fields: [
                {
                  name: isAppointed
                    ? `${BOT_EMOJIS.appointment} ${BOT_LABELS.appointment}`
                    : `${BOT_EMOJIS.demotion} ${BOT_LABELS.demotion}`,
                  value: formatBlockquote([panelText]),
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

              const tmUserId = plan.roster?.teamManagerDiscordUserId;
              const tmUsername = plan.presentation?.teamManager?.username;
              const tmFormatted = tmUserId
                ? formatUserWithVisibleName(tmUserId, tmUsername || 'Unknown User')
                : BOT_LABELS.vacant;

              const description = formatBlockquote([
                `${memberFormatted} has accepted the offer from ${team}`,
                `${BOT_EMOJIS.roster} ${BOT_LABELS.roster}: ${plan.roster?.currentSize ?? 0}/${plan.roster?.maximumSize ?? 0}`,
                `${BOT_EMOJIS.teamManager} ${BOT_LABELS.teamManager}: ${tmFormatted}`,
              ]);

              return createInfoEmbed({
                author,
                title: `${BOT_EMOJIS.success} ${BOT_LABELS.offerAccepted} - ${teamRoleName}`,
                description,
                color: resolveTeamRoleColor(roleColor, BOT_COLORS.info),
                thumbnail,
                footer: footer.text,
                ...(footer.iconURL ? { footerIconURL: footer.iconURL } : {}),
              });
            })()
          : plan.type === 'DEMANDED' || plan.type === 'RELEASED'
            ? (() => {
                const isDemand = plan.type === 'DEMANDED';
                const footer = isDemand
                  ? createActorFooter({
                      verb: 'Action',
                      username: subjectName,
                      avatarUrl: plan.presentation?.subject?.avatarUrl ?? null,
                      timestamp: plan.occurredAt,
                    })
                  : createPlayerFooter({
                      username: subjectName,
                      avatarUrl: plan.presentation?.subject?.avatarUrl ?? null,
                      timestamp: plan.occurredAt,
                    });
                const rosterLine = `${BOT_EMOJIS.roster} ${BOT_LABELS.roster}: ${plan.roster?.currentSize ?? 0}/${plan.roster?.maximumSize ?? 0}`;
                const descriptionLines = [
                  isDemand
                    ? `${memberFormatted} has demanded from ${team}!`
                    : `${memberFormatted} has been released from ${team}!`,
                  rosterLine,
                ];
                if (!isDemand) {
                  const tmUserId = plan.roster?.teamManagerDiscordUserId;
                  const tmUsername = plan.presentation?.teamManager?.username;
                  const tmFormatted = tmUserId
                    ? formatUserWithVisibleName(tmUserId, tmUsername || 'Unknown User')
                    : BOT_LABELS.vacant;
                  descriptionLines.push(
                    `${BOT_EMOJIS.teamManager} ${BOT_LABELS.teamManager}: ${tmFormatted}`,
                  );
                }
                return createInfoEmbed({
                  author,
                  title: `${isDemand ? BOT_EMOJIS.demand : BOT_EMOJIS.release} ${
                    isDemand ? BOT_LABELS.demand : BOT_LABELS.release
                  } - ${teamRoleName}`,
                  description: formatBlockquote(descriptionLines),
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
