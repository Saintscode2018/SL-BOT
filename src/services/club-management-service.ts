import type { Club, PrismaClient } from '@prisma/client';

import {
  ClubInactiveError,
  ConfigurationError,
  DuplicateTeamRoleError,
  EntityNotFoundError,
  InvalidTeamEmojiError,
  NoTeamChangesProvidedError,
} from '../domain/errors.js';
import { assertNoManagementTeamRoleCollision } from '../domain/management-role-collision.js';
import { getEffectiveSquadLimit } from '../domain/squad-limit.js';
import { formatTeamIdentity } from '../domain/team-label.js';
import { AuditEventRepository } from '../repositories/audit-event-repository.js';
import { ClubRepository } from '../repositories/club-repository.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import { MembershipRepository } from '../repositories/membership-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import type { AuthorizationInput } from './authorization-service.js';
import { AuthorizationService } from './authorization-service.js';

export const clubCreatedAuditEventType = 'club.created';
export const clubEditedAuditEventType = 'club.edited';
export const clubDeactivatedAuditEventType = 'club.deactivated';

export interface CreateClubWorkflowInput {
  authorization: AuthorizationInput;
  discordRoleId: string;
  emoji: string;
  squadLimitOverride?: number | null;
}

export interface EditClubWorkflowInput {
  authorization: AuthorizationInput;
  clubId: string;
  discordRoleId?: string;
  emoji?: string;
}

export interface ClubListItem {
  club: Club;
  activePlayerCount: number;
  effectiveLimit: number;
}

export class ClubManagementService {
  public constructor(private readonly database: PrismaClient) {}

  public async create(input: CreateClubWorkflowInput): Promise<Club> {
    const emoji = input.emoji.trim();
    if (emoji.length === 0) throw new InvalidTeamEmojiError();
    await new AuthorizationService(this.database).authorizeLeagueAdministration(input.authorization);

    return this.database.$transaction(async (transaction) => {
      const clubs = new ClubRepository(transaction);
      const guilds = new GuildRepository(transaction);
      await guilds.acquireWriteLock(input.authorization.discordGuildId);
      const lockedAuthorization = await new AuthorizationService(
        transaction,
      ).authorizeLeagueAdministration(input.authorization);
      const settings = await guilds.getSettings(lockedAuthorization.guild.id);
      if (settings !== null) {
        assertNoManagementTeamRoleCollision(settings, [input.discordRoleId]);
      }
      const existingRoleClub = await clubs.getByDiscordRoleId(
        lockedAuthorization.guild.id,
        input.discordRoleId,
      );
      if (existingRoleClub !== null) {
        throw new DuplicateTeamRoleError(
          input.discordRoleId,
          formatTeamIdentity(existingRoleClub, 'message'),
        );
      }

      const actor = await new UserRepository(transaction).getOrCreateByDiscordUserId(
        input.authorization.discordUserId,
      );
      const club = await clubs.create({
        guildId: lockedAuthorization.guild.id,
        discordRoleId: input.discordRoleId,
        emoji,
        ...(input.squadLimitOverride === undefined
          ? {}
          : { squadLimitOverride: input.squadLimitOverride }),
      });
      await new AuditEventRepository(transaction).create({
        guildId: lockedAuthorization.guild.id,
        actorUserId: actor.id,
        eventType: clubCreatedAuditEventType,
        entityType: 'club',
        entityId: club.id,
        afterState: {
          discordRoleId: club.discordRoleId,
          emoji: club.emoji,
          squadLimitOverride: club.squadLimitOverride,
          active: club.active,
        },
      });
      return club;
    });
  }

  public async edit(input: EditClubWorkflowInput): Promise<Club> {
    const emoji = input.emoji?.trim();
    if (emoji !== undefined && emoji.length === 0) throw new InvalidTeamEmojiError();
    await new AuthorizationService(this.database).authorizeLeagueAdministration(input.authorization);

    if (input.discordRoleId === undefined && input.emoji === undefined) {
      throw new NoTeamChangesProvidedError();
    }

    return this.database.$transaction(async (transaction) => {
      const clubs = new ClubRepository(transaction);
      const guilds = new GuildRepository(transaction);
      await guilds.acquireWriteLock(input.authorization.discordGuildId);
      const lockedAuthorization = await new AuthorizationService(
        transaction,
      ).authorizeLeagueAdministration(input.authorization);
      const club = await clubs.getByIdInGuild(input.clubId, lockedAuthorization.guild.id);
      if (club === null) throw new EntityNotFoundError('team was not found');
      if (!club.active) throw new ClubInactiveError('team is inactive');

      if (input.discordRoleId !== undefined && input.discordRoleId !== club.discordRoleId) {
        const settings = await guilds.getSettings(lockedAuthorization.guild.id);
        if (settings !== null) {
          assertNoManagementTeamRoleCollision(settings, [input.discordRoleId]);
        }
        const existingRoleClub = await clubs.getByDiscordRoleId(
          lockedAuthorization.guild.id,
          input.discordRoleId,
        );
        if (existingRoleClub !== null && existingRoleClub.id !== club.id) {
          throw new DuplicateTeamRoleError(
            input.discordRoleId,
            formatTeamIdentity(existingRoleClub, 'message'),
          );
        }
        if (await new MembershipRepository(transaction).hasActiveMembershipOnClub(club.id)) {
          throw new ConfigurationError(
            'The team Discord role cannot be changed while active memberships exist.',
          );
        }
      }

      const actor = await new UserRepository(transaction).getOrCreateByDiscordUserId(
        input.authorization.discordUserId,
      );
      const updatedClub = await clubs.update(club.id, {
        ...(input.discordRoleId === undefined ? {} : { discordRoleId: input.discordRoleId }),
        ...(emoji === undefined ? {} : { emoji }),
      });

      await new AuditEventRepository(transaction).create({
        guildId: lockedAuthorization.guild.id,
        actorUserId: actor.id,
        eventType: clubEditedAuditEventType,
        entityType: 'club',
        entityId: club.id,
        beforeState: {
          discordRoleId: club.discordRoleId,
          emoji: club.emoji,
        },
        afterState: {
          discordRoleId: updatedClub.discordRoleId,
          emoji: updatedClub.emoji,
        },
      });

      return updatedClub;
    });
  }

  public async deactivate(authorizationInput: AuthorizationInput, clubId: string): Promise<Club> {
    await new AuthorizationService(this.database).authorizeLeagueAdministration(authorizationInput);
    return this.database.$transaction(async (transaction) => {
      const clubs = new ClubRepository(transaction);
      const guilds = new GuildRepository(transaction);
      await guilds.acquireWriteLock(authorizationInput.discordGuildId);
      const lockedAuthorization = await new AuthorizationService(
        transaction,
      ).authorizeLeagueAdministration(authorizationInput);
      const club = await clubs.getByIdInGuild(clubId, lockedAuthorization.guild.id);
      if (club === null) throw new EntityNotFoundError('team was not found');
      if (!club.active) throw new ClubInactiveError('team is already inactive');
      const actor = await new UserRepository(transaction).getOrCreateByDiscordUserId(
        authorizationInput.discordUserId,
      );
      const deactivated = await clubs.deactivate(club.id);
      await new AuditEventRepository(transaction).create({
        guildId: lockedAuthorization.guild.id,
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
    const clubs = await new ClubRepository(this.database).listActiveWithUniqueMemberCounts(
      guild.id,
    );
    return clubs.map(({ activePlayerCount, ...club }) => ({
      club,
      activePlayerCount,
      effectiveLimit: getEffectiveSquadLimit(club, settings),
    }));
  }

  public async autocomplete(
    discordGuildId: string,
    query: string,
    limit = 25,
    roleNamesById: Readonly<Record<string, string>> = {},
  ): Promise<Array<{ name: string; value: string }>> {
    const clubs = await new ClubRepository(this.database).listActiveByDiscordGuildId(
      discordGuildId,
    );
    const normalized = query.trim().toLowerCase();
    return clubs
      .map((club) => ({
        club,
        label: formatTeamIdentity(
          { ...club, discordRoleName: roleNamesById[club.discordRoleId] ?? null },
          'autocomplete',
        ),
      }))
      .filter(({ label }) => normalized.length === 0 || label.toLowerCase().includes(normalized))
      .slice(0, Math.min(Math.max(limit, 0), 25))
      .map(({ club, label }) => ({ name: label, value: club.id }));
  }
}
