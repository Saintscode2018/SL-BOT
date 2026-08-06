import type { EmbedBuilder } from 'discord.js';
import {
  ActiveStaffRosterConflictError,
  AdministrativePermissionDeniedError,
  AdministrativeWrongChannelError,
  AlreadyMemberOfClubError,
  AmbiguousActivePlayerMembershipError,
  AuthorizationError,
  BotCommandsChannelNotConfiguredError,
  BotUserNotAllowedError,
  CallerHasNoStaffAppointmentError,
  ClubInactiveError,
  ConfigurationError,
  ConflictError,
  DebugAdministratorPermissionRequiredError,
  DemandRateLimitedError,
  DiscordManageRolesPermissionError,
  DiscordMemberMissingError,
  DiscordRoleCompensationFailedError,
  DiscordRoleHierarchyError,
  DiscordRoleMissingError,
  DiscordRoleNotManageableError,
  DiscordRoleUpdateFailedError,
  DuplicateOfferError,
  DuplicateTeamRoleError,
  EntityNotFoundError,
  GuildConfigurationNotFoundError,
  GuildNotConfiguredError,
  InactiveSourceTeamError,
  InvalidOfferMessageError,
  InvalidConfirmationTokenError,
  InvalidDemotionTargetError,
  InvalidPromotionPathError,
  InvalidStateTransitionError,
  InvalidTeamEmojiError,
  LeagueSetupRequiredError,
  NoStaffAppointmentError,
  NotCurrentlySignedError,
  NoTeamChangesProvidedError,
  OfferDeliveryError,
  OfferExpiredError,
  ConfirmationAlreadyHandledError,
  ConfirmationOwnershipError,
  InsufficientStaffRankError,
  MemberAlreadySignedError,
  MemberIsFreeAgentError,
  MemberNotOnTeamError,
  SelfActionForbiddenError,
  SelfReleaseForbiddenError,
  StaffSlotOccupiedError,
  StaleConfirmationError,
  StaleMutationStateError,
  TargetAlreadyDesiredRankError,
  TargetNotOnCallerTeamError,
  TargetNotStaffError,
  TargetRankNotManageableError,
  TeamManagerCannotDemandError,
  TeamManagerCannotBeReleasedError,
  ReleaseTargetIsFreeAgentError,
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
import { BOT_EMOJIS } from './presentation/index.js';

export interface MappedErrorResponse {
  title: string;
  description: string;
  embed: EmbedBuilder;
}

export function mapDiscordError(error: unknown): MappedErrorResponse {
  let title = `${BOT_EMOJIS.error} Command Failed`;
  let description = 'An unexpected error occurred. Please try again later.';

  if (error instanceof AdministrativePermissionDeniedError) {
    title = `${BOT_EMOJIS.error} Permission Denied`;
    description = error.message;
  } else if (error instanceof DebugAdministratorPermissionRequiredError) {
    title = `${BOT_EMOJIS.error} Permission Denied`;
    description = error.message;
  } else if (error instanceof AdministrativeWrongChannelError) {
    title = `${BOT_EMOJIS.error} Wrong Command Channel`;
    description = `Use this command in <#${error.staffChannelId}>.`;
  } else if (error instanceof WrongCommandChannelError) {
    title = `${BOT_EMOJIS.error} Wrong Command Channel`;
    if (error.allowedChannelIds.length > 1) {
      description = `Use this command in <#${error.allowedChannelIds[0]}> or <#${error.allowedChannelIds[1]}>.`;
    } else {
      description = `Use this command in <#${error.allowedChannelIds[0]}>.`;
    }
  } else if (error instanceof StaffChannelNotConfiguredError) {
    title = `${BOT_EMOJIS.error} Staff Channel Not Configured`;
    description =
      'A Discord Administrator must configure the staff channel with `/setup channels` before this command can be used.';
  } else if (error instanceof BotCommandsChannelNotConfiguredError) {
    title = `${BOT_EMOJIS.error} Bot Commands Channel Not Configured`;
    description =
      'A Discord Administrator must configure the league channels with `/setup channels`.';
  } else if (error instanceof LeagueSetupRequiredError) {
    title = `${BOT_EMOJIS.error} League Setup Required`;
    description = 'A Discord Administrator must run `/setup league` first.';
  } else if (error instanceof DuplicateTeamRoleError) {
    title = `${BOT_EMOJIS.error} Team Role Already in Use`;
    description = `The role <@&${error.roleId}> is already assigned to ${error.teamIdentity}.\n\nChoose a different Discord role.`;
  } else if (error instanceof StaffAlreadyAppointedError) {
    title = `${BOT_EMOJIS.error} Staff Member Already Appointed`;
    description = error.message;
  } else if (error instanceof StaffMemberCannotReceiveOffersError) {
    title = `${BOT_EMOJIS.error} Staff Member Cannot Receive Offers`;
    description = error.message;
  } else if (error instanceof StaffSlotOccupiedError) {
    title = `${BOT_EMOJIS.error} Staff Position Already Occupied`;
    description = 'That staff position is already occupied for this team.';
  } else if (error instanceof TeamPositionOccupiedError) {
    title = `${BOT_EMOJIS.error} Position Already Occupied`;
    description = error.message;
  } else if (error instanceof InvalidTeamEmojiError) {
    title = `${BOT_EMOJIS.error} Invalid Team Emoji`;
    description = error.message;
  } else if (error instanceof NoTeamChangesProvidedError) {
    title = `${BOT_EMOJIS.error} No Team Changes Provided`;
    description = error.message;
  } else if (error instanceof NoStaffAppointmentError) {
    title = `${BOT_EMOJIS.error} Staff Appointment Required`;
    description = error.message;
  } else if (error instanceof CallerHasNoStaffAppointmentError) {
    title = `${BOT_EMOJIS.error} Staff Appointment Required`;
    description = error.message;
  } else if (error instanceof TeamManagerCannotDemandError) {
    title = `${BOT_EMOJIS.error} Team Manager Cannot Demand`;
    description =
      'Team Managers cannot demand from their team. An administrator must remove or replace the Team Manager.';
  } else if (error instanceof NotCurrentlySignedError) {
    title = `${BOT_EMOJIS.error} Not Currently Signed`;
    description = error.message;
  } else if (error instanceof DemandRateLimitedError) {
    title = `${BOT_EMOJIS.error} Demand Rate Limited`;
    description = error.message;
  } else if (error instanceof SelfReleaseForbiddenError) {
    title = `${BOT_EMOJIS.error} Cannot Release Yourself`;
    description = error.message;
  } else if (error instanceof TargetNotOnCallerTeamError) {
    title = `${BOT_EMOJIS.error} Player Not On Your Team`;
    description = error.message;
  } else if (error instanceof ReleaseTargetIsFreeAgentError) {
    title = `${BOT_EMOJIS.error} Player Is Already a Free Agent`;
    description = error.message;
  } else if (error instanceof TeamManagerCannotBeReleasedError) {
    title = `${BOT_EMOJIS.error} Team Manager Cannot Be Released`;
    description = error.message;
  } else if (error instanceof SelfActionForbiddenError) {
    title = `${BOT_EMOJIS.error} Cannot Modify Yourself`;
    description =
      error.message === 'You cannot perform this action on yourself.'
        ? 'You cannot promote or demote yourself with this command.'
        : error.message;
  } else if (error instanceof InvalidPromotionPathError) {
    title = `${BOT_EMOJIS.error} Insufficient Staff Authority`;
    description = 'Assistant Team Managers may only promote ordinary players to Player Manager.';
  } else if (error instanceof InvalidDemotionTargetError) {
    title = `${BOT_EMOJIS.error} Player Is Not Staff`;
    description = 'That player is not currently an Assistant Team Manager or Player Manager.';
  } else if (
    error instanceof InsufficientStaffRankError ||
    error instanceof TargetRankNotManageableError
  ) {
    title = `${BOT_EMOJIS.error} Insufficient Staff Authority`;
    description = 'Your current staff position cannot perform that action.';
  } else if (
    error instanceof DiscordMemberMissingError ||
    error instanceof DiscordRoleMissingError ||
    error instanceof DiscordManageRolesPermissionError ||
    error instanceof DiscordRoleHierarchyError ||
    error instanceof DiscordRoleNotManageableError ||
    error instanceof DiscordRoleUpdateFailedError ||
    error instanceof DiscordRoleCompensationFailedError
  ) {
    title = `${BOT_EMOJIS.error} Discord Role Synchronization Failed`;
    description = error.message;
  } else if (
    error instanceof StaleConfirmationError ||
    error instanceof ConfirmationAlreadyHandledError ||
    error instanceof ConfirmationOwnershipError ||
    error instanceof InvalidConfirmationTokenError
  ) {
    title = `${BOT_EMOJIS.error} Confirmation Unavailable`;
    description = error.message;
  } else if (
    error instanceof MemberAlreadySignedError ||
    error instanceof MemberIsFreeAgentError ||
    error instanceof MemberNotOnTeamError ||
    error instanceof AmbiguousActivePlayerMembershipError ||
    error instanceof ActiveStaffRosterConflictError ||
    error instanceof TargetNotStaffError ||
    error instanceof TargetAlreadyDesiredRankError ||
    error instanceof StaleMutationStateError
  ) {
    title = `${BOT_EMOJIS.error} Roster Action Failed`;
    description = error.message;
  } else if (error instanceof AuthorizationError) {
    title = `${BOT_EMOJIS.error} Permission Denied`;
    description =
      error.message || 'You need the configured bot permissions role to use this command.';
  } else if (
    error instanceof GuildNotConfiguredError ||
    error instanceof GuildConfigurationNotFoundError
  ) {
    title = `${BOT_EMOJIS.error} League Setup Required`;
    description = 'A user with bot permissions must run /setup league first.';
  } else if (error instanceof ConfigurationError) {
    if (error.message.includes('can only be used in')) {
      title = `${BOT_EMOJIS.error} Command Unavailable Here`;
      description = error.message;
    } else if (error.message.toLowerCase().includes('setup')) {
      title = `${BOT_EMOJIS.error} League Setup Required`;
      description = error.message;
    } else {
      title = `${BOT_EMOJIS.error} Configuration Error`;
      description = error.message;
    }
  } else if (error instanceof ValidationError) {
    if (error.message.toLowerCase().includes('emoji')) {
      title = `${BOT_EMOJIS.error} Invalid Team Emoji`;
      description =
        'Choose either a standard Discord emoji or a custom emoji from this server.\n\nExamples: ⚽ or `<:chelsea:123456789012345678>`';
    } else {
      title = `${BOT_EMOJIS.error} Invalid Command Options`;
      description = error.message;
    }
  } else if (error instanceof InactiveSourceTeamError) {
    title = `${BOT_EMOJIS.error} Team Inactive`;
    description = error.message;
  } else if (error instanceof ClubInactiveError) {
    title = `${BOT_EMOJIS.error} Team Inactive`;
    description = 'That team is inactive.';
  } else if (error instanceof TeamNotFoundError) {
    title = `${BOT_EMOJIS.error} Team Not Found`;
    description = 'The selected team does not exist in this server.';
  } else if (error instanceof SquadFullError) {
    title = `${BOT_EMOJIS.error} Squad Limit Reached`;
    description = 'That team has reached its squad limit.';
  } else if (error instanceof AlreadyMemberOfClubError) {
    title = `${BOT_EMOJIS.error} Roster Conflict`;
    description = 'That player already has an active roster membership.';
  } else if (error instanceof DuplicateOfferError) {
    title = `${BOT_EMOJIS.error} Duplicate Offer`;
    description = 'That team already has a pending offer for this player.';
  } else if (error instanceof OfferExpiredError) {
    title = `${BOT_EMOJIS.error} Offer Expired`;
    description = 'This offer has expired.';
  } else if (error instanceof UnauthorizedOfferAcceptanceError) {
    title = `${BOT_EMOJIS.error} Unauthorized`;
    description = 'Only the player who received this offer can respond.';
  } else if (error instanceof InvalidOfferMessageError) {
    title = `${BOT_EMOJIS.error} Invalid Offer Interaction`;
    description = 'This offer interaction is no longer valid.';
  } else if (error instanceof BotUserNotAllowedError) {
    title = `${BOT_EMOJIS.error} Invalid Target`;
    description = 'Bot accounts cannot be selected.';
  } else if (error instanceof OfferDeliveryError) {
    title = `${BOT_EMOJIS.error} Offer Delivery Failed`;
    description =
      error.message === 'offer message could not be delivered'
        ? 'The player could not be contacted privately, so the offer was cancelled.'
        : 'The private offer could not be completed safely. Please contact a league administrator.';
  } else if (error instanceof EntityNotFoundError) {
    title = `${BOT_EMOJIS.error} Record Not Found`;
    description = 'The requested record could not be found.';
  } else if (error instanceof InvalidStateTransitionError || error instanceof ConflictError) {
    title = `${BOT_EMOJIS.error} Conflict`;
    description = 'That action has already been handled or conflicted with another update.';
  }

  const embed = createErrorEmbed({ title, description });
  return { title, description, embed };
}
