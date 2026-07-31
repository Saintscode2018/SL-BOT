import type { Club, PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { ClubInactiveError, EntityNotFoundError } from '../domain/errors.js';
import { AuditEventRepository } from '../repositories/audit-event-repository.js';
import { ClubRepository } from '../repositories/club-repository.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import type { AuthorizationInput } from './authorization-service.js';
import { AuthorizationService } from './authorization-service.js';

export const clubCreatedAuditEventType = 'club.created';
export const clubDeactivatedAuditEventType = 'club.deactivated';

const clubNameSchema = z.string().trim().min(2).max(64);
const clubShortNameSchema = z.string().trim().min(2).max(12);
const squadLimitSchema = z.number().int().min(1).max(100);
const optionalUrlSchema = z.string().url().max(2048).nullable();

export interface CreateClubWorkflowInput {
  authorization: AuthorizationInput;
  name: string;
  shortName: string;
  discordRoleId: string;
  squadLimit: number;
  logoUrl?: string | null;
  emoji?: string | null;
}

export interface ClubListItem {
  club: Club;
  activePlayerCount: number;
}

export class ClubManagementService {
  public constructor(private readonly database: PrismaClient) {}

  public async create(input: CreateClubWorkflowInput): Promise<Club> {
    const authorization = await new AuthorizationService(
      this.database,
    ).authorizeLeagueAdministration(input.authorization);
    const name = clubNameSchema.parse(input.name);
    const shortName = clubShortNameSchema.parse(input.shortName).toUpperCase();
    const squadLimit = squadLimitSchema.parse(input.squadLimit);
    const logoUrl = optionalUrlSchema.parse(input.logoUrl ?? null);
    return this.database.$transaction(async (transaction) => {
      const actor = await new UserRepository(transaction).getOrCreateByDiscordUserId(
        input.authorization.discordUserId,
      );
      const club = await new ClubRepository(transaction).create({
        guildId: authorization.guild.id,
        name,
        shortName,
        discordRoleId: input.discordRoleId,
        squadLimit,
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
          squadLimit: club.squadLimit,
          active: club.active,
        },
      });
      return club;
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
    const guild = await new GuildRepository(this.database).getByDiscordGuildId(discordGuildId);
    if (guild === null) return [];
    const clubs = await new ClubRepository(this.database).listActiveWithPlayerCounts(guild.id);
    return clubs.map(({ activePlayerCount, ...club }) => ({ club, activePlayerCount }));
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
      .map(({ club }) => ({ name: `${club.name} (${club.shortName})`, value: club.id }));
  }
}
