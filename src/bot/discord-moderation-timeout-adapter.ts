import { PermissionsBitField, type Client, type Guild, type GuildMember } from 'discord.js';

import {
  ModerationMemberFetchError,
  ModerationMemberNotFoundError,
  ModerationTimeoutApplyError,
  ModerationTimeoutRemoveError,
} from '../domain/errors.js';
import type {
  ModerationMemberSnapshot,
  ModerationTimeoutRemovalResult,
  ModerationTimeoutGateway,
} from '../services/moderation-mute-service.js';

export class DiscordModerationTimeoutAdapter implements ModerationTimeoutGateway {
  public constructor(private readonly client: Client) {}

  public async inspect(
    discordGuildId: string,
    targetDiscordUserId: string,
  ): Promise<ModerationMemberSnapshot> {
    const guild = await this.fetchGuild(discordGuildId);
    const target = await this.fetchMember(guild, targetDiscordUserId);
    const botMember =
      guild.members.me ??
      (await guild.members.fetchMe().catch((error: unknown) => {
        throw new ModerationMemberFetchError({ cause: error });
      }));
    return {
      targetIsBot: target.user.bot,
      targetIsSelf: target.id === this.client.user?.id,
      targetModeratable: target.moderatable,
      botHasModerateMembers: botMember.permissions.has(PermissionsBitField.Flags.ModerateMembers),
      timeoutUntil: target.communicationDisabledUntil,
    };
  }

  public async applyTimeout(
    discordGuildId: string,
    targetDiscordUserId: string,
    expiresAt: Date,
    reason: string,
  ): Promise<void> {
    try {
      const member = await this.fetchMember(
        await this.fetchGuild(discordGuildId),
        targetDiscordUserId,
      );
      await member.disableCommunicationUntil(expiresAt, reason);
    } catch (error: unknown) {
      if (error instanceof ModerationMemberNotFoundError) throw error;
      throw new ModerationTimeoutApplyError({ cause: error });
    }
  }

  public async removeTimeoutIfExpiresAtMatches(
    discordGuildId: string,
    targetDiscordUserId: string,
    expectedExpiresAt: Date,
    activeAt: Date,
    reason: string,
  ): Promise<ModerationTimeoutRemovalResult> {
    try {
      const member = await this.fetchMember(
        await this.fetchGuild(discordGuildId),
        targetDiscordUserId,
        true,
      );
      if (
        member.communicationDisabledUntil === null ||
        member.communicationDisabledUntil.getTime() <= activeAt.getTime()
      ) {
        return 'ABSENT';
      }
      if (member.communicationDisabledUntil?.getTime() !== expectedExpiresAt.getTime()) {
        return 'MISMATCH';
      }
      await member.timeout(null, reason);
      return 'REMOVED';
    } catch (error: unknown) {
      if (error instanceof ModerationMemberNotFoundError) throw error;
      throw new ModerationTimeoutRemoveError({ cause: error });
    }
  }

  public async restoreTimeout(
    discordGuildId: string,
    targetDiscordUserId: string,
    timeoutUntil: Date | null,
    reason: string,
  ): Promise<void> {
    const member = await this.fetchMember(
      await this.fetchGuild(discordGuildId),
      targetDiscordUserId,
    );
    await member.disableCommunicationUntil(timeoutUntil, reason);
  }

  private async fetchGuild(discordGuildId: string): Promise<Guild> {
    const cached = this.client.guilds.cache.get(discordGuildId);
    if (cached !== undefined) return cached;
    return this.client.guilds.fetch(discordGuildId).catch((error: unknown) => {
      throw new ModerationMemberFetchError({ cause: error });
    });
  }

  private async fetchMember(
    guild: Guild,
    discordUserId: string,
    force = false,
  ): Promise<GuildMember> {
    const cached = guild.members.cache.get(discordUserId);
    if (!force && cached !== undefined) return cached;
    return guild.members.fetch({ user: discordUserId, force: true }).catch((error: unknown) => {
      if (discordErrorCode(error) === 10_007) throw new ModerationMemberNotFoundError();
      throw new ModerationMemberFetchError({ cause: error });
    });
  }
}

function discordErrorCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const parsed = Number(error.code);
  return Number.isFinite(parsed) ? parsed : null;
}
