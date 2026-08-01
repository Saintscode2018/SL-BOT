import type { EmbedBuilder } from 'discord.js';
import {
  AdministrativePermissionDeniedError,
  AdministrativeWrongChannelError,
  AlreadyMemberOfClubError,
  AuthorizationError,
  BotCommandsChannelNotConfiguredError,
  BotUserNotAllowedError,
  ClubInactiveError,
  ConfigurationError,
  ConflictError,
  DebugAdministratorPermissionRequiredError,
  DuplicateOfferError,
  DuplicateTeamNameError,
  DuplicateTeamRoleError,
  DuplicateTeamShortNameError,
  EntityNotFoundError,
  GuildConfigurationNotFoundError,
  GuildNotConfiguredError,
  InvalidOfferMessageError,
  InvalidBannerConfigurationError,
  InvalidStateTransitionError,
  InvalidTeamEmojiError,
  LeagueSetupRequiredError,
  NoStaffAppointmentError,
  OfferDeliveryError,
  OfferExpiredError,
  SquadFullError,
  StaffAlreadyAppointedError,
  StaffChannelNotConfiguredError,
  StaffMemberCannotReceiveOffersError,
  TeamNotFoundError,
  TeamPositionOccupiedError,
  UnauthorizedOfferAcceptanceError,
  ValidationError,
  WrongCommandChannelError,
} from '../domain/errors.js';
import { createErrorEmbed } from './embeds.js';

export interface MappedErrorResponse {
  title: string;
  description: string;
  embed: EmbedBuilder;
}

export function mapDiscordError(error: unknown): MappedErrorResponse {
  let title = '❌ Command Failed';
  let description = 'An unexpected error occurred. Please try again later.';

  if (error instanceof AdministrativePermissionDeniedError) {
    title = '❌ Permission Denied';
    description = error.message;
  } else if (error instanceof DebugAdministratorPermissionRequiredError) {
    title = '❌ Permission Denied';
    description = error.message;
  } else if (error instanceof AdministrativeWrongChannelError) {
    title = '❌ Wrong Command Channel';
    description = `Administrative commands must be used in <#${error.staffChannelId}>.\n\nUse the configured staff commands channel and try again.`;
  } else if (error instanceof WrongCommandChannelError) {
    title = '❌ Wrong Command Channel';
    if (error.guidance === 'bot_commands') {
      description = `Please use <#${error.allowedChannelIds[0]}> for bot commands.`;
    } else if (error.allowedChannelIds.length > 1) {
      description = `Use either <#${error.allowedChannelIds[0]}> or <#${error.allowedChannelIds[1]}> for this command.`;
    } else {
      description = `Please use <#${error.allowedChannelIds[0]}> for this command.`;
    }
  } else if (error instanceof StaffChannelNotConfiguredError) {
    title = '❌ Staff Channel Not Configured';
    description =
      'A Discord Administrator must configure the staff channel with `/setup channels` before this command can be used.';
  } else if (error instanceof BotCommandsChannelNotConfiguredError) {
    title = '❌ Bot Commands Channel Not Configured';
    description =
      'A Discord Administrator must configure the league channels with `/setup channels`.';
  } else if (error instanceof LeagueSetupRequiredError) {
    title = '❌ League Setup Required';
    description = 'A Discord Administrator must run `/setup league` first.';
  } else if (error instanceof DuplicateTeamRoleError) {
    title = '❌ Team Role Already In Use';
    description = `The role <@&${error.roleId}> is already assigned to ${error.teamName}.\n\nChoose a different Discord role for this team.`;
  } else if (error instanceof DuplicateTeamNameError) {
    title = '❌ Team Name Already In Use';
    description = `A team named ${error.teamName} already exists.`;
  } else if (error instanceof DuplicateTeamShortNameError) {
    title = '❌ Team Abbreviation Already In Use';
    description = `The abbreviation ${error.shortName} is already assigned to ${error.teamName}.`;
  } else if (error instanceof StaffAlreadyAppointedError) {
    title = '❌ Staff Member Already Appointed';
    description = error.message;
  } else if (error instanceof StaffMemberCannotReceiveOffersError) {
    title = '❌ Staff Member Cannot Receive Offers';
    description = error.message;
  } else if (error instanceof TeamPositionOccupiedError) {
    title = '❌ Position Already Occupied';
    description = error.message;
  } else if (error instanceof InvalidTeamEmojiError) {
    title = '❌ Invalid Team Emoji';
    description = error.message;
  } else if (error instanceof InvalidBannerConfigurationError) {
    title = '❌ Invalid Banner Configuration';
    description = error.message;
  } else if (error instanceof NoStaffAppointmentError) {
    title = '❌ Staff Appointment Required';
    description = error.message;
  } else if (error instanceof AuthorizationError) {
    title = '❌ Permission Denied';
    description =
      error.message || 'You need the configured bot permissions role to use this command.';
  } else if (
    error instanceof GuildNotConfiguredError ||
    error instanceof GuildConfigurationNotFoundError
  ) {
    title = '❌ League Setup Required';
    description = 'A user with bot permissions must run /setup league first.';
  } else if (error instanceof ConfigurationError) {
    if (error.message.includes('can only be used in')) {
      title = '❌ Command Unavailable Here';
      description = error.message;
    } else if (error.message.toLowerCase().includes('setup')) {
      title = '❌ League Setup Required';
      description = error.message;
    } else {
      title = '❌ Configuration Error';
      description = error.message;
    }
  } else if (error instanceof ValidationError) {
    if (error.message.toLowerCase().includes('emoji')) {
      title = '❌ Invalid Team Emoji';
      description =
        'Choose either a standard Discord emoji or a custom emoji from this server.\n\nExamples: ⚽ or `<:chelsea:123456789012345678>`';
    } else {
      title = '❌ Invalid Command Options';
      description = error.message;
    }
  } else if (error instanceof ClubInactiveError) {
    title = '❌ Team Inactive';
    description = 'That team is inactive.';
  } else if (error instanceof TeamNotFoundError) {
    title = '❌ Team Not Found';
    description = 'The selected team does not exist in this server.';
  } else if (error instanceof SquadFullError) {
    title = '❌ Squad Limit Reached';
    description = 'That team has reached its squad limit.';
  } else if (error instanceof AlreadyMemberOfClubError) {
    title = '❌ Roster Conflict';
    description = 'That player already has an active roster membership.';
  } else if (error instanceof DuplicateOfferError) {
    title = '❌ Duplicate Offer';
    description = 'That team already has a pending offer for this player.';
  } else if (error instanceof OfferExpiredError) {
    title = '❌ Offer Expired';
    description = 'This offer has expired.';
  } else if (error instanceof UnauthorizedOfferAcceptanceError) {
    title = '❌ Unauthorized';
    description = 'Only the player who received this offer can respond.';
  } else if (error instanceof InvalidOfferMessageError) {
    title = '❌ Invalid Offer Interaction';
    description = 'This offer interaction is no longer valid.';
  } else if (error instanceof BotUserNotAllowedError) {
    title = '❌ Invalid Target';
    description = 'Bot accounts cannot be selected.';
  } else if (error instanceof OfferDeliveryError) {
    title = '❌ Offer Delivery Failed';
    description =
      error.message === 'offer message could not be delivered'
        ? 'The player could not be contacted privately, so the offer was cancelled.'
        : 'The private offer could not be completed safely. Please contact a league administrator.';
  } else if (error instanceof EntityNotFoundError) {
    title = '❌ Record Not Found';
    description = 'The requested record could not be found.';
  } else if (error instanceof InvalidStateTransitionError || error instanceof ConflictError) {
    title = '❌ Conflict';
    description = 'That action has already been handled or conflicted with another update.';
  }

  const embed = createErrorEmbed({ title, description });
  return { title, description, embed };
}
