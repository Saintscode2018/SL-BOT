import {
  PermissionsBitField,
  type Client,
  type Guild,
  type GuildMember,
  type Role,
} from 'discord.js';

import { DiscordRoleUpdateFailedError } from '../domain/errors.js';
import type { PlannedDiscordRole } from '../domain/roster-mutation.js';
import type {
  DiscordMemberRoleGateway,
  DiscordMemberRoleSnapshot,
} from '../services/member-role-synchronization-service.js';

export class DiscordMemberRoleAdapter implements DiscordMemberRoleGateway {
  public constructor(private readonly client: Client) {}

  public async inspect(
    discordGuildId: string,
    discordUserId: string,
    roles: readonly PlannedDiscordRole[],
  ): Promise<DiscordMemberRoleSnapshot> {
    const guild = await this.fetchGuild(discordGuildId);
    const member = await guild.members
      .fetch({ user: discordUserId, force: true })
      .catch((error: unknown) => {
        if (discordErrorCode(error) === 10_007) return null;
        throw new DiscordRoleUpdateFailedError({ cause: error });
      });
    const botMember =
      guild.members.me ??
      (await guild.members.fetchMe().catch((error: unknown) => {
        throw new DiscordRoleUpdateFailedError({ cause: error });
      }));
    const resolvedRoles: Array<PlannedDiscordRole & { managed: boolean; position: number }> = [];
    for (const plannedRole of roles) {
      const role = await this.fetchRole(guild, plannedRole.id);
      if (role !== null) {
        resolvedRoles.push({
          ...plannedRole,
          managed: role.managed,
          position: role.position,
        });
      }
    }
    return {
      memberExists: member !== null,
      memberManageable: member?.manageable ?? false,
      botHasManageRoles: botMember.permissions.has(PermissionsBitField.Flags.ManageRoles),
      botHighestRolePosition: botMember.roles.highest.position,
      memberRoleIds: member === null ? [] : [...member.roles.cache.keys()],
      roles: resolvedRoles,
    };
  }

  public async addRole(
    discordGuildId: string,
    discordUserId: string,
    roleId: string,
  ): Promise<void> {
    const member = await this.fetchMember(discordGuildId, discordUserId);
    await member.roles
      .add(roleId, 'SL Bot roster synchronization')
      .then(() => undefined)
      .catch((error: unknown) => {
        throw new DiscordRoleUpdateFailedError({ cause: error });
      });
  }

  public async removeRole(
    discordGuildId: string,
    discordUserId: string,
    roleId: string,
  ): Promise<void> {
    const member = await this.fetchMember(discordGuildId, discordUserId);
    await member.roles
      .remove(roleId, 'SL Bot roster synchronization')
      .then(() => undefined)
      .catch((error: unknown) => {
        throw new DiscordRoleUpdateFailedError({ cause: error });
      });
  }

  private async fetchGuild(discordGuildId: string): Promise<Guild> {
    const cached = this.client.guilds.cache.get(discordGuildId);
    if (cached !== undefined) return cached;
    return this.client.guilds.fetch(discordGuildId).catch((error: unknown) => {
      throw new DiscordRoleUpdateFailedError({ cause: error });
    });
  }

  private async fetchMember(discordGuildId: string, discordUserId: string): Promise<GuildMember> {
    const guild = await this.fetchGuild(discordGuildId);
    return guild.members.fetch({ user: discordUserId, force: true }).catch((error: unknown) => {
      throw new DiscordRoleUpdateFailedError({ cause: error });
    });
  }

  private async fetchRole(guild: Guild, roleId: string): Promise<Role | null> {
    const cached = guild.roles.cache.get(roleId);
    if (cached !== undefined) return cached;
    return guild.roles.fetch(roleId).catch((error: unknown) => {
      if (discordErrorCode(error) === 10_011) return null;
      throw new DiscordRoleUpdateFailedError({ cause: error });
    });
  }
}

function discordErrorCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = error.code;
  if (typeof code === 'number') return code;
  if (typeof code === 'string') {
    const parsed = Number(code);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}
