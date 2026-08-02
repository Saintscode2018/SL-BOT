import type { Client, Guild } from 'discord.js';

import type {
  TransferAnnouncementPlan,
  TransferUserPresentation,
} from '../domain/roster-mutation.js';
import type { TransferAnnouncementPresentationProvider } from '../services/transfer-announcement-service.js';

function resolveUser(
  guild: Guild,
  discordUserId: string | undefined,
): TransferUserPresentation | null {
  if (discordUserId === undefined) return null;
  const member = guild.members.cache.get(discordUserId);
  if (member === undefined) return null;
  const username = member.displayName.trim() || member.user.globalName || member.user.username;
  return {
    username,
    avatarUrl: member.displayAvatarURL(),
  };
}

export class DiscordTransferAnnouncementPresentationProvider implements TransferAnnouncementPresentationProvider {
  public constructor(private readonly client: Client) {}

  public resolve(plan: TransferAnnouncementPlan): Promise<TransferAnnouncementPlan> {
    const guild = this.client.guilds.cache.get(plan.discordGuildId);
    if (guild === undefined) return Promise.resolve(plan);
    const teamRole = guild.roles.cache.get(plan.teamIdentity.discordRoleId);
    return Promise.resolve({
      ...plan,
      presentation: {
        serverName: guild.name,
        serverIconUrl: guild.iconURL(),
        teamRoleName: teamRole?.name ?? null,
        teamRoleColor: teamRole?.color ?? null,
        subject: resolveUser(guild, plan.discordUserId),
        actor: resolveUser(guild, plan.actorDiscordUserId),
      },
    });
  }
}
