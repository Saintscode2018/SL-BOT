import type { Club, LeagueUser, Offer, PrismaClient } from '@prisma/client';

import {
  AlreadyMemberOfClubError,
  BotUserNotAllowedError,
  ClubInactiveError,
  DuplicateOfferError,
  EntityNotFoundError,
  SquadFullError,
} from '../domain/errors.js';
import { AuditEventRepository } from '../repositories/audit-event-repository.js';
import { getEffectiveSquadLimit } from '../domain/squad-limit.js';
import { ClubRepository } from '../repositories/club-repository.js';
import { MembershipRepository } from '../repositories/membership-repository.js';
import { OfferRepository } from '../repositories/offer-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import type { AuthorizationInput } from './authorization-service.js';
import { AuthorizationService } from './authorization-service.js';
import { teamBannerConfigFrom, type TeamBannerConfig } from '../domain/team-label.js';

export const offerCreatedAuditEventType = 'offer.created';

export interface CreateOfferWorkflowInput {
  authorization: AuthorizationInput;
  destinationClubId: string;
  playerDiscordUserId: string;
  playerIsBot: boolean;
  expiresAt?: Date;
}

export interface OfferCreationResult {
  offer: Offer;
  destinationClub: Club;
  sourceClub: Club | null;
  player: LeagueUser;
  offeredBy: LeagueUser;
  leagueName: string;
  activePlayerCount: number;
  effectiveSquadLimit: number;
  bannerConfig?: TeamBannerConfig;
}

export class OfferCreationService {
  public constructor(private readonly database: PrismaClient) {}

  public async createOffer(input: CreateOfferWorkflowInput): Promise<OfferCreationResult> {
    if (input.playerIsBot) throw new BotUserNotAllowedError('bots cannot receive offers');
    const authorization = await new AuthorizationService(this.database).authorizeClubAction(
      input.authorization,
      input.destinationClubId,
    );
    return this.database.$transaction(async (transaction) => {
      const clubs = new ClubRepository(transaction);
      const destinationClub = await clubs.getByIdInGuild(
        input.destinationClubId,
        authorization.guild.id,
      );
      if (destinationClub === null) throw new EntityNotFoundError('team was not found');
      if (!destinationClub.active) throw new ClubInactiveError('team is inactive');
      const users = new UserRepository(transaction);
      const player = await users.getOrCreateByDiscordUserId(input.playerDiscordUserId);
      const offeredBy = await users.getOrCreateByDiscordUserId(input.authorization.discordUserId);
      const memberships = new MembershipRepository(transaction);
      const activeMembership = await memberships.getActivePlayerMembership(
        authorization.guild.id,
        player.id,
      );
      if (activeMembership?.clubId === destinationClub.id) {
        throw new AlreadyMemberOfClubError('player is already active on the destination team');
      }
      const playerCount = await memberships.countActivePlayers(destinationClub.id);
      const effectiveSquadLimit = getEffectiveSquadLimit(destinationClub, authorization.settings);
      if (playerCount >= effectiveSquadLimit) {
        throw new SquadFullError('destination team roster is full');
      }
      const offers = new OfferRepository(transaction);
      if ((await offers.getPendingForClubAndPlayer(destinationClub.id, player.id)) !== null) {
        throw new DuplicateOfferError('a pending offer already exists for this player and team');
      }
      const expiresAt =
        input.expiresAt ?? new Date(Date.now() + authorization.settings.offerTimeoutSeconds * 1000);
      const offer = await offers.createPending({
        guildId: authorization.guild.id,
        clubId: destinationClub.id,
        playerUserId: player.id,
        offeredByUserId: offeredBy.id,
        expiresAt,
      });
      const sourceClub =
        activeMembership === null
          ? null
          : await clubs.getByIdInGuild(activeMembership.clubId, authorization.guild.id);
      await new AuditEventRepository(transaction).create({
        guildId: authorization.guild.id,
        actorUserId: offeredBy.id,
        eventType: offerCreatedAuditEventType,
        entityType: 'offer',
        entityId: offer.id,
        afterState: {
          status: offer.status,
          destinationClubId: destinationClub.id,
          playerUserId: player.id,
          expiresAt: offer.expiresAt.toISOString(),
        },
        metadata: { sourceClubId: sourceClub?.id ?? null },
      });
      return {
        offer,
        destinationClub,
        sourceClub,
        player,
        offeredBy,
        leagueName: authorization.guild.name,
        activePlayerCount: playerCount,
        effectiveSquadLimit,
        bannerConfig: teamBannerConfigFrom(authorization.settings),
      };
    });
  }
}
