import type { Club, PrismaClient } from '@prisma/client';
import { z } from 'zod';

import {
  ClubInactiveError,
  DuplicateTeamNameError,
  DuplicateTeamRoleError,
  DuplicateTeamShortNameError,
  EntityNotFoundError,
  ValidationError,
} from '../domain/errors.js';
import { getEffectiveSquadLimit } from '../domain/squad-limit.js';
import { formatTeamAutocompleteLabel, formatTeamLabel } from '../domain/team-label.js';
import { AuditEventRepository } from '../repositories/audit-event-repository.js';
import { ClubRepository } from '../repositories/club-repository.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import type { AuthorizationInput } from './authorization-service.js';
import { AuthorizationService } from './authorization-service.js';

export const clubCreatedAuditEventType = 'club.created';
export const clubEditedAuditEventType = 'club.edited';
export const clubDeactivatedAuditEventType = 'club.deactivated';

const clubNameSchema = z.string().trim().min(2).max(64);
const clubShortNameSchema = z.string().trim().min(2).max(12);
const optionalUrlSchema = z.string().url().max(2048).nullable();

export interface CreateClubWorkflowInput {
  authorization: AuthorizationInput;
  name: string;
  shortName: string;
  discordRoleId: string;
  squadLimit?: number; // legacy support
  squadLimitOverride?: number | null;
  logoUrl?: string | null;
  emoji?: string | null;
}

export interface EditClubWorkflowInput {
  authorization: AuthorizationInput;
  clubId: string;
  name?: string;
  shortName?: string;
  discordRoleId?: string;
  logoUrl?: string | null;
  emoji?: string | null;
}

export interface ClubListItem {
  club: Club;
  activePlayerCount: number;
  effectiveLimit: number;
  remainingSpaces: number;
}

export class ClubManagementService {
  public constructor(private readonly database: PrismaClient) {}

  public async create(input: CreateClubWorkflowInput): Promise<Club> {
    const authorization = await new AuthorizationService(
      this.database,
    ).authorizeLeagueAdministration(input.authorization);
    const name = clubNameSchema.parse(input.name);
    const shortName = clubShortNameSchema.parse(input.shortName).toUpperCase();
    const logoUrl = optionalUrlSchema.parse(input.logoUrl ?? null);
    const squadLimitOverride =
      input.squadLimitOverride !== undefined
        ? input.squadLimitOverride
        : input.squadLimit !== undefined && input.squadLimit !== 17
          ? input.squadLimit
          : null;
    return this.database.$transaction(async (transaction) => {
      const clubs = new ClubRepository(transaction);
      const existingRoleClub = await clubs.getByDiscordRoleId(
        authorization.guild.id,
        input.discordRoleId,
      );
      if (existingRoleClub !== null) {
        throw new DuplicateTeamRoleError(input.discordRoleId, formatTeamLabel(existingRoleClub));
      }
      const existingNameClub = await clubs.getByName(authorization.guild.id, name);
      if (existingNameClub !== null) {
        throw new DuplicateTeamNameError(formatTeamLabel(existingNameClub));
      }
      const existingShortNameClub = await clubs.getByShortName(authorization.guild.id, shortName);
      if (existingShortNameClub !== null) {
        throw new DuplicateTeamShortNameError(shortName, formatTeamLabel(existingShortNameClub));
      }

      const actor = await new UserRepository(transaction).getOrCreateByDiscordUserId(
        input.authorization.discordUserId,
      );
      const club = await clubs.create({
        guildId: authorization.guild.id,
        name,
        shortName,
        discordRoleId: input.discordRoleId,
        squadLimitOverride,
        logoUrl,
        emoji: input.emoji?.trim() || null,
      });
      await new AuditEventRepository(transaction).create({
        guildId: authorization.guild.id,
        actorUserId: actor.id,
        eventType: clubCreatedAuditEventType,
        entityType: 'club',
        entityId: club.id,
        afterState: {
          name: club.name,
          shortName: club.shortName,
          discordRoleId: club.discordRoleId,
          squadLimitOverride: club.squadLimitOverride,
          active: club.active,
        },
      });
      return club;
    });
  }

  public async edit(input: EditClubWorkflowInput): Promise<Club> {
    const authorization = await new AuthorizationService(
      this.database,
    ).authorizeLeagueAdministration(input.authorization);

    if (
      input.name === undefined &&
      input.shortName === undefined &&
      input.discordRoleId === undefined &&
      input.logoUrl === undefined &&
      input.emoji === undefined
    ) {
      throw new ValidationError('at least one property must be edited');
    }

    return this.database.$transaction(async (transaction) => {
      const clubs = new ClubRepository(transaction);
      const club = await clubs.getByIdInGuild(input.clubId, authorization.guild.id);
      if (club === null) throw new EntityNotFoundError('team was not found');
      if (!club.active) throw new ClubInactiveError('team is inactive');

      if (input.discordRoleId !== undefined && input.discordRoleId !== club.discordRoleId) {
        const existingRoleClub = await clubs.getByDiscordRoleId(
          authorization.guild.id,
          input.discordRoleId,
        );
        if (existingRoleClub !== null && existingRoleClub.id !== club.id) {
          throw new DuplicateTeamRoleError(input.discordRoleId, formatTeamLabel(existingRoleClub));
        }
      }
      if (input.name !== undefined) {
        const parsedName = clubNameSchema.parse(input.name);
        if (parsedName !== club.name) {
          const existingNameClub = await clubs.getByName(authorization.guild.id, parsedName);
          if (existingNameClub !== null && existingNameClub.id !== club.id) {
            throw new DuplicateTeamNameError(formatTeamLabel(existingNameClub));
          }
        }
      }
      if (input.shortName !== undefined) {
        const parsedShortName = clubShortNameSchema.parse(input.shortName).toUpperCase();
        if (parsedShortName !== club.shortName) {
          const existingShortNameClub = await clubs.getByShortName(
            authorization.guild.id,
            parsedShortName,
          );
          if (existingShortNameClub !== null && existingShortNameClub.id !== club.id) {
            throw new DuplicateTeamShortNameError(
              parsedShortName,
              formatTeamLabel(existingShortNameClub),
            );
          }
        }
      }

      const actor = await new UserRepository(transaction).getOrCreateByDiscordUserId(
        input.authorization.discordUserId,
      );

      const updates: {
        name?: string;
        shortName?: string;
        discordRoleId?: string;
        logoUrl?: string | null;
        emoji?: string | null;
      } = {};

      if (input.name !== undefined) updates.name = clubNameSchema.parse(input.name);
      if (input.shortName !== undefined) {
        updates.shortName = clubShortNameSchema.parse(input.shortName).toUpperCase();
      }
      if (input.discordRoleId !== undefined) updates.discordRoleId = input.discordRoleId;
      if (input.logoUrl !== undefined) {
        updates.logoUrl = optionalUrlSchema.parse(input.logoUrl);
      }
      if (input.emoji !== undefined) {
        updates.emoji = input.emoji === null ? null : input.emoji.trim() || null;
      }

      const updatedClub = await clubs.update(club.id, updates);

      await new AuditEventRepository(transaction).create({
        guildId: authorization.guild.id,
        actorUserId: actor.id,
        eventType: clubEditedAuditEventType,
        entityType: 'club',
        entityId: club.id,
        beforeState: {
          name: club.name,
          shortName: club.shortName,
          discordRoleId: club.discordRoleId,
          logoUrl: club.logoUrl,
          emoji: club.emoji,
        },
        afterState: {
          name: updatedClub.name,
          shortName: updatedClub.shortName,
          discordRoleId: updatedClub.discordRoleId,
          logoUrl: updatedClub.logoUrl,
          emoji: updatedClub.emoji,
        },
      });

      return updatedClub;
    });
  }

  public async deactivate(authorizationInput: AuthorizationInput, clubId: string): Promise<Club> {
    const authorization = await new AuthorizationService(
      this.database,
    ).authorizeLeagueAdministration(authorizationInput);
    return this.database.$transaction(async (transaction) => {
      const clubs = new ClubRepository(transaction);
      const club = await clubs.getByIdInGuild(clubId, authorization.guild.id);
      if (club === null) throw new EntityNotFoundError('team was not found');
      if (!club.active) throw new ClubInactiveError('team is already inactive');
      const actor = await new UserRepository(transaction).getOrCreateByDiscordUserId(
        authorizationInput.discordUserId,
      );
      const deactivated = await clubs.deactivate(club.id);
      await new AuditEventRepository(transaction).create({
        guildId: authorization.guild.id,
        actorUserId: actor.id,
        eventType: clubDeactivatedAuditEventType,
        entityType: 'club',
        entityId: club.id,
        beforeState: { active: true },
        afterState: { active: false },
      });
      return deactivated;
    });
  }

  public async listActive(discordGuildId: string): Promise<ClubListItem[]> {
    const guilds = new GuildRepository(this.database);
    const guild = await guilds.getByDiscordGuildId(discordGuildId);
    if (guild === null) return [];
    const settings = await guilds.getSettings(guild.id);
    const clubs = await new ClubRepository(this.database).listActiveWithPlayerCounts(guild.id);
    return clubs.map(({ activePlayerCount, ...club }) => {
      const effectiveLimit = getEffectiveSquadLimit(club, settings);
      const remainingSpaces = Math.max(0, effectiveLimit - activePlayerCount);
      return {
        club,
        activePlayerCount,
        effectiveLimit,
        remainingSpaces,
      };
    });
  }

  public async autocomplete(
    discordGuildId: string,
    query: string,
    limit = 25,
  ): Promise<Array<{ name: string; value: string }>> {
    const items = await this.listActive(discordGuildId);
    const normalized = query.trim().toLowerCase();
    return items
      .filter(
        ({ club }) =>
          normalized.length === 0 ||
          club.name.toLowerCase().includes(normalized) ||
          club.shortName.toLowerCase().includes(normalized),
      )
      .slice(0, Math.min(limit, 25))
      .map(({ club }) => ({ name: formatTeamAutocompleteLabel(club), value: club.id }));
  }
}
