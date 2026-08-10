import type {
  Club,
  ClubMembership,
  Guild,
  LeagueTransaction,
  LeagueUser,
  Prisma,
  PrismaClient,
} from '@prisma/client';

import {
  ActiveStaffRosterConflictError,
  AmbiguousActivePlayerMembershipError,
  BotUserNotAllowedError,
  ClubInactiveError,
  MemberAlreadySignedError,
  MemberIsFreeAgentError,
  SquadFullError,
  TeamNotFoundError,
} from '../domain/errors.js';
import type {
  AuditAnnouncementPlan,
  MemberRoleMutationPlan,
  MutationPlans,
  TransferAnnouncementPlan,
} from '../domain/roster-mutation.js';
import { getEffectiveSquadLimit } from '../domain/squad-limit.js';
import { AuditEventRepository } from '../repositories/audit-event-repository.js';
import { ClubRepository } from '../repositories/club-repository.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import { MembershipRepository } from '../repositories/membership-repository.js';
import { LeagueTransactionRepository } from '../repositories/transaction-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import type { AuthorizationInput } from './authorization-service.js';
import { AuthorizationService } from './authorization-service.js';
import {
  rosterPlayerAddedAuditEventType,
  rosterPlayerRemovedAuditEventType,
} from './roster-management-service.js';
import { voidCompetingOffersForSigning } from './offer-signing-invalidation-service.js';
import type {
  RoleSynchronizedMutationService,
  SynchronizedMutationResult,
} from './role-synchronized-mutation-service.js';

export interface AdministrativeRosterAddInput {
  authorization: AuthorizationInput;
  clubId: string;
  playerDiscordUserId: string;
  playerIsBot: boolean;
  occurredAt?: Date;
}

export interface AdministrativeRosterRemoveInput {
  authorization: AuthorizationInput;
  playerDiscordUserId: string;
  occurredAt?: Date;
}

export interface AdministrativeRosterMutationResult extends MutationPlans {
  guild: Guild;
  club: Club;
  player: LeagueUser;
  membership: ClubMembership;
  transaction: LeagueTransaction;
}

interface PlannedAdd {
  guildId: string;
  roleMutation: MemberRoleMutationPlan;
}

interface PlannedRemove extends PlannedAdd {
  clubId: string;
}

export class RosterAdministrationService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly synchronization: Pick<RoleSynchronizedMutationService, 'execute'>,
  ) {}

  public async add(
    input: AdministrativeRosterAddInput,
  ): Promise<SynchronizedMutationResult<AdministrativeRosterMutationResult>> {
    if (input.playerIsBot) throw new BotUserNotAllowedError('bots cannot join a roster');
    const authorization = await new AuthorizationService(
      this.database,
    ).authorizeLeagueAdministration(input.authorization);
    const planned = await this.database.$transaction((transaction) =>
      this.planAdd(transaction, authorization.guild.id, input),
    );

    return this.synchronization.execute(planned.roleMutation, () =>
      this.database.$transaction((transaction) =>
        this.commitAdd(transaction, planned.guildId, input),
      ),
    );
  }

  public async remove(
    input: AdministrativeRosterRemoveInput,
  ): Promise<SynchronizedMutationResult<AdministrativeRosterMutationResult>> {
    const authorization = await new AuthorizationService(
      this.database,
    ).authorizeLeagueAdministration(input.authorization);
    const planned = await this.database.$transaction((transaction) =>
      this.planRemove(transaction, authorization.guild.id, input),
    );

    return this.synchronization.execute(planned.roleMutation, () =>
      this.database.$transaction((transaction) =>
        this.commitRemove(transaction, planned.guildId, planned.clubId, input),
      ),
    );
  }

  private async planAdd(
    transaction: Prisma.TransactionClient,
    guildId: string,
    input: AdministrativeRosterAddInput,
  ): Promise<PlannedAdd> {
    const club = await this.requireActiveClub(transaction, guildId, input.clubId);
    await this.assertFreeAgentAndCapacity(transaction, guildId, club, input.playerDiscordUserId);
    return {
      guildId,
      roleMutation: this.roleMutation(
        input.authorization.discordGuildId,
        input.playerDiscordUserId,
        {
          add: club.discordRoleId,
        },
      ),
    };
  }

  private async commitAdd(
    transaction: Prisma.TransactionClient,
    guildId: string,
    input: AdministrativeRosterAddInput,
  ): Promise<AdministrativeRosterMutationResult> {
    const club = await this.requireActiveClub(transaction, guildId, input.clubId);
    await this.assertFreeAgentAndCapacity(transaction, guildId, club, input.playerDiscordUserId);
    const users = new UserRepository(transaction);
    const actor = await users.getOrCreateByDiscordUserId(input.authorization.discordUserId);
    const player = await users.getOrCreateByDiscordUserId(input.playerDiscordUserId);
    const occurredAt = input.occurredAt ?? new Date();
    const memberships = new MembershipRepository(transaction);
    const membership = await memberships.createActive({
      guildId,
      clubId: club.id,
      userId: player.id,
      membershipType: 'PLAYER',
      joinedAt: occurredAt,
      createdByUserId: actor.id,
    });
    const leagueTransaction = await new LeagueTransactionRepository(transaction).create({
      guildId,
      userId: player.id,
      transactionType: 'SIGNING',
      destinationClubId: club.id,
      performedByUserId: actor.id,
    });
    await new AuditEventRepository(transaction).create({
      guildId,
      actorUserId: actor.id,
      eventType: rosterPlayerAddedAuditEventType,
      entityType: 'membership',
      entityId: membership.id,
      afterState: { status: membership.status, clubId: club.id, playerUserId: player.id },
      metadata: { transactionId: leagueTransaction.id },
    });
    await voidCompetingOffersForSigning(transaction, {
      guildId,
      playerUserId: player.id,
      acceptedOfferId: null,
      membershipId: membership.id,
      destinationClubId: club.id,
      occurredAt,
    });
    const guild = await this.requireGuild(transaction, guildId);
    const settings = await new GuildRepository(transaction).getSettings(guildId);
    const activePlayerCount = await memberships.countActiveUniqueMembers(club.id);
    const tmMembership = await memberships.getActiveStaffAppointment(club.id, 'TEAM_MANAGER');
    const teamManager = tmMembership === null ? null : await users.getById(tmMembership.userId);

    const announcement: TransferAnnouncementPlan | null = settings?.transferChannelId
      ? {
          discordGuildId: guild.discordGuildId,
          channelId: settings.transferChannelId,
          type: 'SIGNED',
          discordUserId: player.discordUserId,
          teamIdentity: club,
          occurredAt,
          actorDiscordUserId: actor.discordUserId,
          roster: {
            currentSize: activePlayerCount,
            maximumSize: getEffectiveSquadLimit(club, settings),
            teamManagerDiscordUserId: teamManager?.discordUserId ?? null,
          },
        }
      : null;

    const auditAnnouncement: AuditAnnouncementPlan | null = settings?.auditChannelId
      ? {
          discordGuildId: guild.discordGuildId,
          channelId: settings.auditChannelId,
          operation: 'ROSTER_PLAYER_ADDED',
          actorDiscordUserId: actor.discordUserId,
          playerDiscordUserId: player.discordUserId,
          teamIdentity: club,
          occurredAt,
        }
      : null;

    return {
      guild,
      club,
      player,
      membership,
      transaction: leagueTransaction,
      roleMutation: this.roleMutation(
        input.authorization.discordGuildId,
        input.playerDiscordUserId,
        { add: club.discordRoleId },
      ),
      announcement,
      auditAnnouncement,
    };
  }

  private async planRemove(
    transaction: Prisma.TransactionClient,
    guildId: string,
    input: AdministrativeRosterRemoveInput,
  ): Promise<PlannedRemove> {
    const resolved = await this.requireOrdinaryPlayer(
      transaction,
      guildId,
      input.playerDiscordUserId,
    );
    return {
      guildId,
      clubId: resolved.membership.clubId,
      roleMutation: this.roleMutation(
        input.authorization.discordGuildId,
        input.playerDiscordUserId,
        {
          remove: resolved.club.discordRoleId,
        },
      ),
    };
  }

  private async commitRemove(
    transaction: Prisma.TransactionClient,
    guildId: string,
    expectedClubId: string,
    input: AdministrativeRosterRemoveInput,
  ): Promise<AdministrativeRosterMutationResult> {
    const resolved = await this.requireOrdinaryPlayer(
      transaction,
      guildId,
      input.playerDiscordUserId,
    );
    if (resolved.membership.clubId !== expectedClubId) {
      throw new AmbiguousActivePlayerMembershipError();
    }
    const users = new UserRepository(transaction);
    const actor = await users.getOrCreateByDiscordUserId(input.authorization.discordUserId);
    const occurredAt = input.occurredAt ?? new Date();
    const memberships = new MembershipRepository(transaction);
    const membership = await memberships.end(resolved.membership.id, {
      leftAt: occurredAt,
      endedByUserId: actor.id,
    });
    const leagueTransaction = await new LeagueTransactionRepository(transaction).create({
      guildId,
      userId: resolved.player.id,
      transactionType: 'RELEASE',
      sourceClubId: resolved.club.id,
      performedByUserId: actor.id,
    });
    await new AuditEventRepository(transaction).create({
      guildId,
      actorUserId: actor.id,
      eventType: rosterPlayerRemovedAuditEventType,
      entityType: 'membership',
      entityId: membership.id,
      beforeState: {
        status: 'ACTIVE',
        clubId: resolved.club.id,
        playerUserId: resolved.player.id,
      },
      afterState: { status: 'ENDED', leftAt: occurredAt.toISOString() },
      metadata: { transactionId: leagueTransaction.id },
    });
    const guild = await this.requireGuild(transaction, guildId);
    const settings = await new GuildRepository(transaction).getSettings(guildId);
    const activePlayerCount = await memberships.countActiveUniqueMembers(resolved.club.id);
    const tmMembership = await memberships.getActiveStaffAppointment(
      resolved.club.id,
      'TEAM_MANAGER',
    );
    const teamManager = tmMembership === null ? null : await users.getById(tmMembership.userId);

    const announcement: TransferAnnouncementPlan | null = settings?.transferChannelId
      ? {
          discordGuildId: guild.discordGuildId,
          channelId: settings.transferChannelId,
          type: 'RELEASED',
          discordUserId: resolved.player.discordUserId,
          teamIdentity: resolved.club,
          occurredAt,
          actorDiscordUserId: actor.discordUserId,
          roster: {
            currentSize: activePlayerCount,
            maximumSize: getEffectiveSquadLimit(resolved.club, settings),
            teamManagerDiscordUserId: teamManager?.discordUserId ?? null,
          },
        }
      : null;

    const auditAnnouncement: AuditAnnouncementPlan | null = settings?.auditChannelId
      ? {
          discordGuildId: guild.discordGuildId,
          channelId: settings.auditChannelId,
          operation: 'ROSTER_PLAYER_REMOVED',
          actorDiscordUserId: actor.discordUserId,
          playerDiscordUserId: resolved.player.discordUserId,
          teamIdentity: resolved.club,
          occurredAt,
        }
      : null;

    return {
      guild,
      club: resolved.club,
      player: resolved.player,
      membership,
      transaction: leagueTransaction,
      roleMutation: this.roleMutation(
        input.authorization.discordGuildId,
        input.playerDiscordUserId,
        { remove: resolved.club.discordRoleId },
      ),
      announcement,
      auditAnnouncement,
    };
  }

  private async assertFreeAgentAndCapacity(
    transaction: Prisma.TransactionClient,
    guildId: string,
    club: Club,
    discordUserId: string,
  ): Promise<void> {
    const player = await new UserRepository(transaction).getByDiscordUserId(discordUserId);
    const memberships = new MembershipRepository(transaction);
    if (player !== null) {
      const activeStaff = await memberships.getActiveStaffMembershipForUserInGuild(
        guildId,
        player.id,
      );
      if (activeStaff !== null) throw new ActiveStaffRosterConflictError('add');
      const activePlayers = await memberships.listActivePlayerMembershipsForUserInGuild(
        guildId,
        player.id,
      );
      if (activePlayers.length > 0) throw new MemberAlreadySignedError();
    }
    const settings = await new GuildRepository(transaction).getSettings(guildId);
    const activePlayerCount = await memberships.countActiveUniqueMembers(club.id);
    if (activePlayerCount >= getEffectiveSquadLimit(club, settings)) {
      throw new SquadFullError('destination team roster is full');
    }
  }

  private async requireOrdinaryPlayer(
    transaction: Prisma.TransactionClient,
    guildId: string,
    discordUserId: string,
  ): Promise<{ player: LeagueUser; membership: ClubMembership; club: Club }> {
    const player = await new UserRepository(transaction).getByDiscordUserId(discordUserId);
    if (player === null) throw new MemberIsFreeAgentError();
    const memberships = new MembershipRepository(transaction);
    const activeStaff = await memberships.getActiveStaffMembershipForUserInGuild(
      guildId,
      player.id,
    );
    if (activeStaff !== null) throw new ActiveStaffRosterConflictError('remove');
    const activePlayers = await memberships.listActivePlayerMembershipsForUserInGuild(
      guildId,
      player.id,
    );
    if (activePlayers.length === 0) throw new MemberIsFreeAgentError();
    if (activePlayers.length !== 1) throw new AmbiguousActivePlayerMembershipError();
    const membership = activePlayers[0];
    if (membership === undefined) throw new MemberIsFreeAgentError();
    return { player, membership, club: membership.club };
  }

  private async requireActiveClub(
    transaction: Prisma.TransactionClient,
    guildId: string,
    clubId: string,
  ): Promise<Club> {
    const club = await new ClubRepository(transaction).getByIdInGuild(clubId, guildId);
    if (club === null) throw new TeamNotFoundError('team was not found in this server');
    if (!club.active) throw new ClubInactiveError('team is inactive');
    return club;
  }

  private async requireGuild(
    transaction: Prisma.TransactionClient,
    guildId: string,
  ): Promise<Guild> {
    const guild = await transaction.guild.findUnique({ where: { id: guildId } });
    if (guild === null) throw new TeamNotFoundError('server was not found');
    return guild;
  }

  private roleMutation(
    discordGuildId: string,
    discordUserId: string,
    role: { add: string } | { remove: string },
  ): MemberRoleMutationPlan {
    return {
      discordGuildId,
      discordUserId,
      addRoles: 'add' in role ? [{ id: role.add, purpose: 'TEAM' }] : [],
      removeRoles: 'remove' in role ? [{ id: role.remove, purpose: 'TEAM' }] : [],
    };
  }
}
