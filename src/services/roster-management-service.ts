import type {
  Club,
  ClubMembership,
  LeagueTransaction,
  LeagueUser,
  PrismaClient,
} from '@prisma/client';

import {
  AlreadyMemberOfClubError,
  BotUserNotAllowedError,
  ClubInactiveError,
  EntityNotFoundError,
  SquadFullError,
  TeamNotFoundError,
} from '../domain/errors.js';
import { getEffectiveSquadLimit } from '../domain/squad-limit.js';
import { AuditEventRepository } from '../repositories/audit-event-repository.js';
import { ClubRepository } from '../repositories/club-repository.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import { MembershipRepository } from '../repositories/membership-repository.js';
import { LeagueTransactionRepository } from '../repositories/transaction-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import type { AuthorizationInput } from './authorization-service.js';
import { AuthorizationService } from './authorization-service.js';

export const rosterPlayerAddedAuditEventType = 'roster.player_added';
export const rosterPlayerRemovedAuditEventType = 'roster.player_removed';

export interface AddRosterPlayerInput {
  authorization: AuthorizationInput;
  clubId: string;
  playerDiscordUserId: string;
  playerIsBot: boolean;
  robloxUsername?: string | null;
  robloxUserId?: string | null;
  addedAt?: Date;
}

export interface RosterMutationResult {
  membership: ClubMembership;
  transaction: LeagueTransaction;
  player: LeagueUser;
  club: Club;
}

export class RosterManagementService {
  public constructor(private readonly database: PrismaClient) {}

  public async add(input: AddRosterPlayerInput): Promise<RosterMutationResult> {
    if (input.playerIsBot) throw new BotUserNotAllowedError('bots cannot join a roster');
    const authorization = await new AuthorizationService(this.database).authorizeClubAction(
      input.authorization,
      input.clubId,
    );
    return this.database.$transaction(async (transaction) => {
      const club = await new ClubRepository(transaction).getByIdInGuild(
        input.clubId,
        authorization.guild.id,
      );
      if (club === null) throw new EntityNotFoundError('team was not found');
      if (!club.active) throw new ClubInactiveError('team is inactive');
      const users = new UserRepository(transaction);
      const actor = await users.getOrCreateByDiscordUserId(input.authorization.discordUserId);
      let player = await users.getOrCreateByDiscordUserId(input.playerDiscordUserId);
      if (input.robloxUserId !== undefined || input.robloxUsername !== undefined) {
        player = await users.updateRobloxIdentity(player.id, {
          robloxUserId: input.robloxUserId ?? player.robloxUserId,
          robloxUsername: input.robloxUsername ?? player.robloxUsername,
        });
      }
      const memberships = new MembershipRepository(transaction);
      const existing = await memberships.getActivePlayerMembership(
        authorization.guild.id,
        player.id,
      );
      if (existing !== null) {
        throw new AlreadyMemberOfClubError('player already has an active roster membership');
      }
      const playerCount = await memberships.countActivePlayers(club.id);
      const settings = await new GuildRepository(transaction).getSettings(authorization.guild.id);
      const effectiveLimit = getEffectiveSquadLimit(club, settings);
      if (playerCount >= effectiveLimit) throw new SquadFullError('team roster is full');
      const addedAt = input.addedAt ?? new Date();
      const membership = await memberships.createActive({
        guildId: authorization.guild.id,
        clubId: club.id,
        userId: player.id,
        membershipType: 'PLAYER',
        joinedAt: addedAt,
        createdByUserId: actor.id,
      });
      const leagueTransaction = await new LeagueTransactionRepository(transaction).create({
        guildId: authorization.guild.id,
        userId: player.id,
        transactionType: 'SIGNING',
        destinationClubId: club.id,
        performedByUserId: actor.id,
      });
      await new AuditEventRepository(transaction).create({
        guildId: authorization.guild.id,
        actorUserId: actor.id,
        eventType: rosterPlayerAddedAuditEventType,
        entityType: 'membership',
        entityId: membership.id,
        afterState: {
          status: membership.status,
          clubId: club.id,
          playerUserId: player.id,
        },
        metadata: { transactionId: leagueTransaction.id },
      });
      return { membership, transaction: leagueTransaction, player, club };
    });
  }

  public async remove(
    authorizationInput: AuthorizationInput,
    clubId: string,
    playerDiscordUserId: string,
    reason?: string | null,
    removedAt = new Date(),
  ): Promise<RosterMutationResult> {
    const authorization = await new AuthorizationService(this.database).authorizeClubAction(
      authorizationInput,
      clubId,
    );
    return this.database.$transaction(async (transaction) => {
      const club = await new ClubRepository(transaction).getByIdInGuild(
        clubId,
        authorization.guild.id,
      );
      if (club === null) throw new EntityNotFoundError('team was not found');
      const users = new UserRepository(transaction);
      const actor = await users.getOrCreateByDiscordUserId(authorizationInput.discordUserId);
      const player = await users.getByDiscordUserId(playerDiscordUserId);
      if (player === null) throw new EntityNotFoundError('player was not found');
      const memberships = new MembershipRepository(transaction);
      const active = await memberships.getActivePlayerMembership(authorization.guild.id, player.id);
      if (active === null || active.clubId !== club.id) {
        throw new EntityNotFoundError('player is not active on this team');
      }
      const membership = await memberships.end(active.id, {
        leftAt: removedAt,
        endedByUserId: actor.id,
      });
      const activeStaff = await memberships.getActiveStaffMembershipForUser(club.id, player.id);
      if (activeStaff !== null) {
        await memberships.end(activeStaff.id, {
          leftAt: removedAt,
          endedByUserId: actor.id,
        });
      }
      const leagueTransaction = await new LeagueTransactionRepository(transaction).create({
        guildId: authorization.guild.id,
        userId: player.id,
        transactionType: 'RELEASE',
        sourceClubId: club.id,
        performedByUserId: actor.id,
        reason: reason ?? null,
      });
      await new AuditEventRepository(transaction).create({
        guildId: authorization.guild.id,
        actorUserId: actor.id,
        eventType: rosterPlayerRemovedAuditEventType,
        entityType: 'membership',
        entityId: membership.id,
        beforeState: { status: 'ACTIVE', clubId: club.id, playerUserId: player.id },
        afterState: { status: 'ENDED', leftAt: removedAt.toISOString() },
        metadata: { transactionId: leagueTransaction.id, reason: reason ?? null },
      });
      return { membership, transaction: leagueTransaction, player, club };
    });
  }

  public async list(
    discordGuildId: string,
    clubId: string,
  ): Promise<{
    club: Club;
    allActiveMembers: Array<ClubMembership & { user: LeagueUser }>;
    activeStaffUserIds: Set<string>;
    ordinaryPlayers: Array<ClubMembership & { user: LeagueUser }>;
    staff: Array<ClubMembership & { user: LeagueUser }>;
  }> {
    return this.database.$transaction(async (transaction) => {
      const guild = await new GuildRepository(transaction).getByDiscordGuildId(discordGuildId);
      if (guild === null) throw new EntityNotFoundError('server is not configured');
      const club = await new ClubRepository(transaction).getByIdInGuild(clubId, guild.id);
      if (club === null) throw new TeamNotFoundError('team was not found in this server');
      if (!club.active) throw new ClubInactiveError('team is inactive');
      const memberships = new MembershipRepository(transaction);
      const [allActiveMembers, staff] = await Promise.all([
        memberships.listActivePlayersWithUsers(club.id),
        memberships.listActiveStaffWithUsers(club.id),
      ]);
      const activeStaffUserIds = new Set(staff.map(({ userId }) => userId));
      const ordinaryPlayers = allActiveMembers.filter(
        ({ userId }) => !activeStaffUserIds.has(userId),
      );
      return { club, allActiveMembers, activeStaffUserIds, ordinaryPlayers, staff };
    });
  }
}
