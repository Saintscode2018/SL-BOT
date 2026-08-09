import type { Client, Guild } from 'discord.js';

import type { AuditAnnouncementPlan, TransferUserPresentation } from '../domain/roster-mutation.js';
import type { AuditAnnouncementPresentationProvider } from '../services/audit-announcement-service.js';

function presentMember(member: {
  displayName?: string;
  user?: { globalName?: string | null; username?: string };
  displayAvatarURL?: () => string;
}): TransferUserPresentation | null {
  const username = member.displayName?.trim() || member.user?.globalName || member.user?.username;
  if (!username) return null;
  return {
    username,
    avatarUrl: typeof member.displayAvatarURL === 'function' ? member.displayAvatarURL() : null,
  };
}

function presentUser(user: {
  globalName?: string | null;
  username?: string;
  displayAvatarURL?: () => string;
}): TransferUserPresentation | null {
  const username = user.globalName || user.username;
  if (!username) return null;
  return {
    username,
    avatarUrl: typeof user.displayAvatarURL === 'function' ? user.displayAvatarURL() : null,
  };
}

async function resolveUser(
  client: Client,
  guild: Guild,
  discordUserId: string | undefined,
): Promise<TransferUserPresentation | null> {
  if (discordUserId === undefined) return null;
  const member = guild.members?.cache?.get(discordUserId);
  if (member !== undefined && member !== null) {
    const presented = presentMember(member);
    if (presented !== null) return presented;
  }
  if (typeof guild.members?.fetch === 'function') {
    const fetchedMember = await guild.members.fetch(discordUserId).catch(() => null);
    if (fetchedMember !== null) {
      const presented = presentMember(fetchedMember);
      if (presented !== null) return presented;
    }
  }
  const user =
    guild.client?.users?.cache?.get(discordUserId) ?? client.users?.cache?.get(discordUserId);
  if (user !== undefined && user !== null) {
    const presented = presentUser(user);
    if (presented !== null) return presented;
  }
  if (typeof client.users?.fetch === 'function') {
    const fetchedUser = await client.users.fetch(discordUserId).catch(() => null);
    if (fetchedUser !== null) return presentUser(fetchedUser);
  }
  return null;
}

async function resolveGuild(client: Client, discordGuildId: string): Promise<Guild | null> {
  const cached = client.guilds.cache.get(discordGuildId);
  if (cached !== undefined) return cached;
  if (typeof client.guilds.fetch !== 'function') return null;
  return client.guilds.fetch(discordGuildId).catch(() => null);
}

async function resolveTeamRole(
  guild: Guild,
  roleId: string,
): Promise<{ name: string; color: number } | null> {
  const cached = guild.roles.cache.get(roleId);
  if (cached !== undefined) return cached;
  if (typeof guild.roles.fetch !== 'function') return null;
  return guild.roles.fetch(roleId).catch(() => null);
}

export class DiscordAuditAnnouncementPresentationProvider implements AuditAnnouncementPresentationProvider {
  public constructor(private readonly client: Client) {}

  public async resolve(plan: AuditAnnouncementPlan): Promise<AuditAnnouncementPlan> {
    const guild = await resolveGuild(this.client, plan.discordGuildId);
    if (guild === null) return plan;
    const resolvedUsers = new Map<string, Promise<TransferUserPresentation | null>>();
    const userPresentation = (discordUserId: string | undefined) => {
      if (discordUserId === undefined) return Promise.resolve(null);
      const existing = resolvedUsers.get(discordUserId);
      if (existing !== undefined) return existing;
      const resolution = resolveUser(this.client, guild, discordUserId);
      resolvedUsers.set(discordUserId, resolution);
      return resolution;
    };
    if (plan.operation === 'TEAM_SWAPPED') {
      return {
        ...plan,
        presentation: {
          serverName: guild.name,
          serverIconUrl: typeof guild.iconURL === 'function' ? guild.iconURL() : null,
          subject: null,
          actor: await userPresentation(plan.actorDiscordUserId),
        },
      };
    }
    const subjectDiscordUserId =
      plan.operation === 'TEAM_DISBANDED' ? undefined : plan.playerDiscordUserId;
    const actorDiscordUserId = 'actorDiscordUserId' in plan ? plan.actorDiscordUserId : undefined;
    const [teamRole, subject, actor] = await Promise.all([
      resolveTeamRole(guild, plan.teamIdentity.discordRoleId),
      userPresentation(subjectDiscordUserId),
      userPresentation(actorDiscordUserId),
    ]);
    return {
      ...plan,
      presentation: {
        serverName: guild.name,
        serverIconUrl: typeof guild.iconURL === 'function' ? guild.iconURL() : null,
        teamRoleName: teamRole?.name ?? null,
        teamRoleColor: teamRole?.color ?? null,
        subject,
        actor,
      },
    };
  }
}
