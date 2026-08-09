import type { Client, Guild } from 'discord.js';

import type {
  ModerationAnnouncementPlan,
  ModerationAnnouncementPresentationProvider,
  ModerationUserPresentation,
} from '../services/moderation-announcement-service.js';

function presentUser(value: {
  displayName?: string;
  displayAvatarURL?: () => string;
  user?: { globalName?: string | null; username?: string };
  globalName?: string | null;
  username?: string;
}): ModerationUserPresentation | null {
  const username =
    value.displayName?.trim() ||
    value.user?.globalName ||
    value.user?.username ||
    value.globalName ||
    value.username;
  if (!username) return null;
  return {
    username,
    avatarUrl: typeof value.displayAvatarURL === 'function' ? value.displayAvatarURL() : null,
  };
}

async function resolveGuild(client: Client, discordGuildId: string): Promise<Guild | null> {
  return (
    client.guilds.cache.get(discordGuildId) ??
    (await client.guilds.fetch(discordGuildId).catch(() => null))
  );
}

async function resolveUser(
  client: Client,
  guild: Guild,
  discordUserId: string,
): Promise<ModerationUserPresentation | null> {
  const cachedMember = guild.members.cache.get(discordUserId);
  if (cachedMember !== undefined) return presentUser(cachedMember);
  const member = await guild.members.fetch(discordUserId).catch(() => null);
  if (member !== null) return presentUser(member);
  const cachedUser = client.users.cache.get(discordUserId);
  if (cachedUser !== undefined) return presentUser(cachedUser);
  const user = await client.users.fetch(discordUserId).catch(() => null);
  return user === null ? null : presentUser(user);
}

export class DiscordModerationAnnouncementPresentationProvider implements ModerationAnnouncementPresentationProvider {
  public constructor(private readonly client: Client) {}

  public async resolve(plan: ModerationAnnouncementPlan): Promise<ModerationAnnouncementPlan> {
    const guild = await resolveGuild(this.client, plan.discordGuildId);
    if (guild === null) return plan;
    const [target, actor] = await Promise.all([
      resolveUser(this.client, guild, plan.targetDiscordUserId),
      resolveUser(this.client, guild, plan.actorDiscordUserId),
    ]);
    return {
      ...plan,
      presentation: {
        serverName: guild.name,
        serverIconUrl: guild.iconURL(),
        target,
        actor,
      },
    };
  }
}
