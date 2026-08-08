import type { Client, Guild } from 'discord.js';

import type { AuditAnnouncementPlan, TransferUserPresentation } from '../domain/roster-mutation.js';
import type { AuditAnnouncementPresentationProvider } from '../services/audit-announcement-service.js';

function resolveUser(
  guild: Guild,
  discordUserId: string | undefined,
): TransferUserPresentation | null {
  if (discordUserId === undefined) return null;
  const member = guild.members?.cache?.get(discordUserId);
  if (member !== undefined && member !== null) {
    const username = member.displayName?.trim() || member.user?.globalName || member.user?.username;
    if (username) {
      return {
        username,
        avatarUrl: typeof member.displayAvatarURL === 'function' ? member.displayAvatarURL() : null,
      };
    }
  }
  const user = guild.client?.users?.cache?.get(discordUserId);
  if (user !== undefined && user !== null) {
    const username = user.globalName || user.username;
    if (username) {
      return {
        username,
        avatarUrl: typeof user.displayAvatarURL === 'function' ? user.displayAvatarURL() : null,
      };
    }
  }
  return null;
}

export class DiscordAuditAnnouncementPresentationProvider implements AuditAnnouncementPresentationProvider {
  public constructor(private readonly client: Client) {}

  public resolve(plan: AuditAnnouncementPlan): Promise<AuditAnnouncementPlan> {
    if (
      plan.operation === 'OFFER_CREATED' ||
      plan.operation === 'OFFER_DECLINED' ||
      plan.operation === 'OFFER_EXPIRED'
    ) {
      return Promise.resolve(plan);
    }
    const guild = this.client.guilds.cache.get(plan.discordGuildId);
    if (guild === undefined) return Promise.resolve(plan);
    if (plan.operation === 'TEAM_SWAPPED') {
      return Promise.resolve({
        ...plan,
        presentation: {
          serverName: guild.name,
          serverIconUrl: typeof guild.iconURL === 'function' ? guild.iconURL() : null,
          subject: null,
          actor: resolveUser(guild, plan.actorDiscordUserId),
        },
      });
    }
    const teamRole = guild.roles.cache.get(plan.teamIdentity.discordRoleId);
    return Promise.resolve({
      ...plan,
      presentation: {
        serverName: guild.name,
        serverIconUrl: typeof guild.iconURL === 'function' ? guild.iconURL() : null,
        teamRoleName: teamRole?.name ?? null,
        teamRoleColor: teamRole?.color ?? null,
        subject:
          plan.operation === 'TEAM_DISBANDED' ? null : resolveUser(guild, plan.playerDiscordUserId),
        actor: resolveUser(guild, plan.actorDiscordUserId),
      },
    });
  }
}
