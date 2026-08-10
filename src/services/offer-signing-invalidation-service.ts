import type { DatabaseClient } from '../domain/types.js';
import { AuditEventRepository } from '../repositories/audit-event-repository.js';
import { OfferRepository } from '../repositories/offer-repository.js';

export const offerVoidedForSigningAuditEventType = 'offer.voided_for_signing';

export interface VoidCompetingOffersForSigningInput {
  guildId: string;
  playerUserId: string;
  acceptedOfferId: string | null;
  membershipId: string;
  destinationClubId: string;
  occurredAt: Date;
}

export async function voidCompetingOffersForSigning(
  database: DatabaseClient,
  input: VoidCompetingOffersForSigningInput,
): Promise<void> {
  const voidedOffers = await new OfferRepository(database).voidPendingForSignedPlayer(
    input.guildId,
    input.playerUserId,
    input.acceptedOfferId,
    input.occurredAt,
  );
  const audits = new AuditEventRepository(database);
  for (const offer of voidedOffers) {
    await audits.create({
      guildId: input.guildId,
      eventType: offerVoidedForSigningAuditEventType,
      entityType: 'offer',
      entityId: offer.id,
      beforeState: { status: 'PENDING' },
      afterState: { status: 'VOIDED', respondedAt: input.occurredAt.toISOString() },
      metadata: {
        reason: 'PLAYER_SIGNED_ELSEWHERE',
        ...(input.acceptedOfferId === null ? {} : { acceptedOfferId: input.acceptedOfferId }),
        membershipId: input.membershipId,
        destinationClubId: input.destinationClubId,
      },
    });
  }
}
