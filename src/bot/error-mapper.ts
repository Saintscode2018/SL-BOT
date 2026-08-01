import type { EmbedBuilder } from 'discord.js';
import {
  AlreadyMemberOfClubError,
  AuthorizationError,
  BotUserNotAllowedError,
  ClubInactiveError,
  ConfigurationError,
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
  ValidationError,
} from '../domain/errors.js';
import { createErrorEmbed } from './embeds.js';

export interface MappedErrorResponse {
  title: string;
  description: string;
  embed: EmbedBuilder;
}

export function mapDiscordError(error: unknown): MappedErrorResponse {
  let title = 'Command failed';
  let description = 'An unexpected error occurred. Please try again later.';

  if (error instanceof AuthorizationError) {
    title = 'Permission denied';
    description =
      error.message || 'You need the configured bot permissions role to use this command.';
  } else if (
    error instanceof GuildNotConfiguredError ||
    error instanceof GuildConfigurationNotFoundError
  ) {
    title = 'League setup required';
    description = 'A user with bot permissions must run /setup league first.';
  } else if (error instanceof ConfigurationError) {
    if (error.message.includes('can only be used in')) {
      title = 'Command unavailable here';
      description = error.message;
    } else if (error.message.toLowerCase().includes('setup')) {
      title = 'League setup required';
      description = error.message;
    } else {
      title = 'Configuration error';
      description = error.message;
    }
  } else if (error instanceof ValidationError) {
    title = 'Invalid command options';
    description = error.message;
  } else if (error instanceof ClubInactiveError) {
    title = 'Team inactive';
    description = 'That team is inactive.';
  } else if (error instanceof SquadFullError) {
    title = 'Squad limit reached';
    description = 'That team has reached its squad limit.';
  } else if (error instanceof AlreadyMemberOfClubError) {
    title = 'Roster conflict';
    description = 'That player already has an active roster membership.';
  } else if (error instanceof DuplicateOfferError) {
    title = 'Duplicate offer';
    description = 'That team already has a pending offer for this player.';
  } else if (error instanceof OfferExpiredError) {
    title = 'Offer expired';
    description = 'This offer has expired.';
  } else if (error instanceof UnauthorizedOfferAcceptanceError) {
    title = 'Unauthorized';
    description = 'Only the player who received this offer can respond.';
  } else if (error instanceof InvalidOfferMessageError) {
    title = 'Invalid offer interaction';
    description = 'This offer interaction is no longer valid.';
  } else if (error instanceof BotUserNotAllowedError) {
    title = 'Invalid target';
    description = 'Bot accounts cannot be selected.';
  } else if (error instanceof OfferDeliveryError) {
    title = 'Offer delivery failed';
    description =
      error.message === 'offer message could not be delivered'
        ? 'The player could not be contacted privately, so the offer was cancelled.'
        : 'The private offer could not be completed safely. Please contact a league administrator.';
  } else if (error instanceof EntityNotFoundError) {
    title = 'Record not found';
    description = 'The requested record could not be found.';
  } else if (error instanceof InvalidStateTransitionError || error instanceof ConflictError) {
    title = 'Conflict';
    description = 'That action has already been handled or conflicted with another update.';
  }

  const embed = createErrorEmbed({ title, description });
  return { title, description, embed };
}
