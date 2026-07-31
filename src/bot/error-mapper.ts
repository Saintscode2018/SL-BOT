import {
  AlreadyMemberOfClubError,
  AuthorizationError,
  BotUserNotAllowedError,
  ClubInactiveError,
  ConflictError,
  DuplicateOfferError,
  EntityNotFoundError,
  GuildConfigurationNotFoundError,
  GuildNotConfiguredError,
  InvalidOfferMessageError,
  InvalidStateTransitionError,
  OfferDeliveryError,
  OfferExpiredError,
  SquadFullError,
  UnauthorizedOfferAcceptanceError,
} from '../domain/errors.js';

export function mapDiscordError(error: unknown): string {
  if (error instanceof AuthorizationError) return 'You are not authorized to do that.';
  if (
    error instanceof GuildNotConfiguredError ||
    error instanceof GuildConfigurationNotFoundError
  ) {
    return 'This server has not been configured yet.';
  }
  if (error instanceof ClubInactiveError) return 'That team is inactive.';
  if (error instanceof SquadFullError) return 'That team has reached its squad limit.';
  if (error instanceof AlreadyMemberOfClubError) {
    return 'That player already has an active roster membership.';
  }
  if (error instanceof DuplicateOfferError)
    return 'That team already has a pending offer for this player.';
  if (error instanceof OfferExpiredError) return 'This offer has expired.';
  if (error instanceof UnauthorizedOfferAcceptanceError) {
    return 'Only the player who received this offer can respond.';
  }
  if (error instanceof InvalidOfferMessageError) return 'This offer interaction is not valid.';
  if (error instanceof BotUserNotAllowedError) return 'Bot accounts cannot be selected.';
  if (error instanceof OfferDeliveryError)
    return 'The offer could not be delivered and was made unusable.';
  if (error instanceof EntityNotFoundError) return 'The requested record could not be found.';
  if (error instanceof InvalidStateTransitionError || error instanceof ConflictError) {
    return 'That action has already been handled or conflicted with another update.';
  }
  return 'The command could not be completed. Please try again later.';
}
