import type { Club, PrismaClient } from '@prisma/client';

import { getEffectiveSquadLimit } from '../domain/squad-limit.js';
import { ValidationError } from '../domain/errors.js';
import type { AuthorizationInput } from './authorization-service.js';
import { AuthorizationService } from './authorization-service.js';
import { AuditEventRepository } from '../repositories/audit-event-repository.js';
import { ClubRepository } from '../repositories/club-repository.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import { UserRepository } from '../repositories/user-repository.js';

function validateAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
    throw new ValidationError('squad limit must be an integer between 1 and 100');
  }
}

export interface SetDefaultLimitInput {
  authorization: AuthorizationInput;
  amount: number;
}

export interface SetTeamLimitInput {
  authorization: AuthorizationInput;
  clubId: string;
  amount: number;
}

export interface ResetTeamLimitInput {
  authorization: AuthorizationInput;
  clubId: string;
}

export interface LimitViewResult {
  defaultSquadLimit: number;
  clubsWithOverrides: Array<{
    club: Club;
    override: number;
    effectiveLimit: number;
  }>;
  selectedClub?:
    | {
        club: Club;
        override: number | null;
        effectiveLimit: number;
      }
    | undefined;
}

export class LimitManagementService {
  public constructor(private readonly database: PrismaClient) {}

  public async setDefaultLimit(
    input: SetDefaultLimitInput,
  ): Promise<{ defaultSquadLimit: number }> {
    validateAmount(input.amount);
    await new AuthorizationService(this.database).authorizeLeagueAdministration(
      input.authorization,
    );
    return this.database.$transaction(async (transaction) => {
      const guilds = new GuildRepository(transaction);
      const guild = await guilds.getByDiscordGuildId(input.authorization.discordGuildId);
      if (guild === null) {
        throw new ValidationError('guild has not been setup yet');
      }
      const actor = await new UserRepository(transaction).getOrCreateByDiscordUserId(
        input.authorization.discordUserId,
      );
      const previousSettings = await guilds.getSettings(guild.id);
      const previousDefault = previousSettings?.defaultSquadLimit ?? 17;
      const settings = await guilds.upsertSettings(guild.id, {
        defaultSquadLimit: input.amount,
      });
      await new AuditEventRepository(transaction).create({
        guildId: guild.id,
        actorUserId: actor.id,
        eventType: 'limit.default_updated',
        entityType: 'guild_settings',
        entityId: settings.id,
        beforeState: { defaultSquadLimit: previousDefault },
        afterState: { defaultSquadLimit: settings.defaultSquadLimit },
      });
      return { defaultSquadLimit: settings.defaultSquadLimit };
    });
  }

  public async setTeamLimit(input: SetTeamLimitInput): Promise<{
    club: Club;
    override: number;
    effectiveLimit: number;
  }> {
    validateAmount(input.amount);
    await new AuthorizationService(this.database).authorizeLeagueAdministration(
      input.authorization,
    );
    return this.database.$transaction(async (transaction) => {
      const guilds = new GuildRepository(transaction);
      const clubs = new ClubRepository(transaction);
      const guild = await guilds.getByDiscordGuildId(input.authorization.discordGuildId);
      if (guild === null) {
        throw new ValidationError('guild has not been setup yet');
      }
      const club = await clubs.getByIdInGuild(input.clubId, guild.id);
      if (club === null || !club.active) {
        throw new ValidationError('team was not found or is inactive');
      }
      const actor = await new UserRepository(transaction).getOrCreateByDiscordUserId(
        input.authorization.discordUserId,
      );
      const settings = await guilds.getSettings(guild.id);
      const updatedClub = await clubs.update(club.id, { squadLimitOverride: input.amount });
      const effectiveLimit = getEffectiveSquadLimit(updatedClub, settings);

      await new AuditEventRepository(transaction).create({
        guildId: guild.id,
        actorUserId: actor.id,
        eventType: 'limit.team_override_updated',
        entityType: 'club',
        entityId: club.id,
        beforeState: { squadLimitOverride: club.squadLimitOverride },
        afterState: { squadLimitOverride: updatedClub.squadLimitOverride },
      });

      return {
        club: updatedClub,
        override: input.amount,
        effectiveLimit,
      };
    });
  }

  public async resetTeamLimit(input: ResetTeamLimitInput): Promise<{
    club: Club;
    effectiveLimit: number;
  }> {
    await new AuthorizationService(this.database).authorizeLeagueAdministration(
      input.authorization,
    );
    return this.database.$transaction(async (transaction) => {
      const guilds = new GuildRepository(transaction);
      const clubs = new ClubRepository(transaction);
      const guild = await guilds.getByDiscordGuildId(input.authorization.discordGuildId);
      if (guild === null) {
        throw new ValidationError('guild has not been setup yet');
      }
      const club = await clubs.getByIdInGuild(input.clubId, guild.id);
      if (club === null || !club.active) {
        throw new ValidationError('team was not found or is inactive');
      }
      const actor = await new UserRepository(transaction).getOrCreateByDiscordUserId(
        input.authorization.discordUserId,
      );
      const settings = await guilds.getSettings(guild.id);
      const updatedClub = await clubs.update(club.id, { squadLimitOverride: null });
      const effectiveLimit = getEffectiveSquadLimit(updatedClub, settings);

      await new AuditEventRepository(transaction).create({
        guildId: guild.id,
        actorUserId: actor.id,
        eventType: 'limit.team_override_reset',
        entityType: 'club',
        entityId: club.id,
        beforeState: { squadLimitOverride: club.squadLimitOverride },
        afterState: { squadLimitOverride: null },
      });

      return {
        club: updatedClub,
        effectiveLimit,
      };
    });
  }

  public async viewLimit(discordGuildId: string, clubId?: string): Promise<LimitViewResult> {
    const guilds = new GuildRepository(this.database);
    const clubsRepo = new ClubRepository(this.database);
    const guild = await guilds.getByDiscordGuildId(discordGuildId);
    if (guild === null) {
      throw new ValidationError('guild has not been setup yet');
    }
    const settings = await guilds.getSettings(guild.id);
    const defaultSquadLimit = settings?.defaultSquadLimit ?? 17;
    const activeClubs = await clubsRepo.listActive(guild.id);

    const clubsWithOverrides = activeClubs
      .filter((c) => c.squadLimitOverride !== null)
      .map((c) => ({
        club: c,
        override: c.squadLimitOverride!,
        effectiveLimit: getEffectiveSquadLimit(c, settings),
      }));

    let selectedClub: LimitViewResult['selectedClub'];
    if (clubId !== undefined) {
      const found = activeClubs.find((c) => c.id === clubId);
      if (found !== undefined) {
        selectedClub = {
          club: found,
          override: found.squadLimitOverride,
          effectiveLimit: getEffectiveSquadLimit(found, settings),
        };
      }
    }

    return {
      defaultSquadLimit,
      clubsWithOverrides,
      selectedClub,
    };
  }
}
