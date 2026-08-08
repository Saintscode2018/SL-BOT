export class DomainError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class EntityNotFoundError extends DomainError {}

export class ConflictError extends DomainError {}

export class InvalidStateTransitionError extends DomainError {}

export class ConstraintViolationError extends DomainError {}

export class ValidationError extends DomainError {}

export class ConfigurationError extends DomainError {}

export class ApplicationStartupError extends DomainError {}

export class GuildConfigurationNotFoundError extends DomainError {
  public constructor(
    public readonly missingResource: 'guild' | 'settings',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class OfferExpiredError extends DomainError {}

export class SquadFullError extends DomainError {}

export class UnauthorizedOfferAcceptanceError extends DomainError {}

export class AlreadyMemberOfClubError extends DomainError {}

export class AuthorizationError extends DomainError {}

export class AdministrativePermissionDeniedError extends AuthorizationError {
  public constructor() {
    super(
      'You do not have permission to use this administrative command.\n\nAsk a league administrator if you believe you should have access.',
    );
  }
}

export class BotPermissionManagementError extends DomainError {}

export class BotPermissionAlreadyGrantedError extends BotPermissionManagementError {
  public constructor() {
    super('That user already has a standard Bot Permission.');
  }
}

export class BotPermissionAdminAlreadyGrantedError extends BotPermissionManagementError {
  public constructor() {
    super('That user is already a Bot Permission Admin.');
  }
}

export class BotPermissionAdminProtectedError extends BotPermissionManagementError {
  public constructor() {
    super('Bot Permission Admins cannot be removed with `/setup botperm remove`.');
  }
}

export class BotPermissionNotFoundError extends BotPermissionManagementError {
  public constructor() {
    super('That user does not have a standard Bot Permission.');
  }
}

export class LastBotPermissionRemovalError extends BotPermissionManagementError {
  public constructor() {
    super('The final Bot Permission cannot be removed because the server would be locked out.');
  }
}

export class AdministrativeWrongChannelError extends ConfigurationError {
  public constructor(public readonly staffChannelId: string) {
    super(`administrative command used outside staff channel ${staffChannelId}`);
  }
}

export class WrongCommandChannelError extends ConfigurationError {
  public constructor(
    public readonly allowedChannelIds: readonly string[],
    public readonly guidance: 'bot_or_staff' | 'global',
  ) {
    super('command used outside its permitted channels');
  }
}

export class StaffChannelNotConfiguredError extends ConfigurationError {
  public constructor() {
    super('staff channel is not configured');
  }
}

export class BotCommandsChannelNotConfiguredError extends ConfigurationError {
  public constructor() {
    super('bot commands channel is not configured');
  }
}

export class LeagueSetupRequiredError extends ConfigurationError {
  public constructor() {
    super('league setup is required');
  }
}

export class GuildNotConfiguredError extends DomainError {}

export class ClubInactiveError extends DomainError {}

export class InactiveSourceTeamError extends ClubInactiveError {
  public constructor(public readonly teamIdentity: string) {
    super(`Source team ${teamIdentity} is inactive.`);
  }
}

export class TeamNotFoundError extends EntityNotFoundError {}

export class DuplicateOfferError extends DomainError {}

export class BotUserNotAllowedError extends DomainError {}

export class OfferDeliveryError extends DomainError {}

export class InvalidOfferMessageError extends DomainError {}

export class DuplicateTeamRoleError extends ConflictError {
  public constructor(
    public readonly roleId: string,
    public readonly teamIdentity: string,
  ) {
    super(`The role <@&${roleId}> is already assigned to ${teamIdentity}.`);
  }
}

export class NoTeamChangesProvidedError extends ValidationError {
  public constructor() {
    super('Choose a new team role or team emoji to update.');
  }
}

export class StaffAlreadyAppointedError extends ConflictError {
  public constructor(
    public readonly discordUserId: string,
    public readonly positionName: string,
    public readonly teamName: string,
  ) {
    super(
      `<@${discordUserId}> is already the ${positionName} of ${teamName}.\n\nThey must be removed from that position before receiving another appointment.`,
    );
  }
}

export class StaffMemberCannotReceiveOffersError extends ConflictError {
  public constructor(
    public readonly discordUserId: string,
    public readonly positionName: string,
    public readonly teamName: string,
  ) {
    super(
      `<@${discordUserId}> is currently the ${positionName} of ${teamName}.\n\nActive team staff must be removed from their staff position before they can receive a player contract offer.`,
    );
  }
}

export class TeamPositionOccupiedError extends ConflictError {
  public constructor(
    public readonly positionName: string,
    public readonly teamName: string,
    public readonly currentHolderUserId?: string,
  ) {
    super(
      `${teamName} already has a ${positionName}${
        currentHolderUserId === undefined ? '' : `: <@${currentHolderUserId}>`
      }.\n\nRemove the current ${positionName} before appointing another one.`,
    );
  }
}

export class InvalidTeamEmojiError extends DomainError {
  public constructor(message?: string) {
    super(
      message ??
        'Choose either a standard Discord emoji or a custom emoji from this server.\n\nExamples: ⚽ or `<:chelsea:123456789012345678>`',
    );
  }
}

export class NoStaffAppointmentError extends DomainError {
  public constructor() {
    super(
      'You must be an active Team Manager, Assistant Team Manager, or Player Manager of a team to issue contract offers.',
    );
  }
}

export class CallerHasNoStaffAppointmentError extends AuthorizationError {
  public readonly code = 'CALLER_HAS_NO_STAFF_APPOINTMENT';

  public constructor() {
    super(
      'You must be an active Team Manager, Assistant Team Manager, or Player Manager to release a player.',
    );
  }
}

export class NotCurrentlySignedError extends InvalidStateTransitionError {
  public readonly code = 'NOT_CURRENTLY_SIGNED';

  public constructor() {
    super('You are not currently registered to a team.');
  }
}

export class DemandRateLimitedError extends AuthorizationError {
  public readonly code = 'DEMAND_RATE_LIMITED';

  public constructor(public readonly remainingSeconds: number) {
    super(
      `Please wait ${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'} before using /demand again.`,
    );
  }
}

export class MemberAlreadySignedError extends ConflictError {
  public readonly code = 'MEMBER_ALREADY_SIGNED';

  public constructor() {
    super('That user is already signed to a team and must become a free agent first.');
  }
}

export class MemberIsFreeAgentError extends InvalidStateTransitionError {
  public readonly code = 'MEMBER_IS_FREE_AGENT';

  public constructor() {
    super('That user is already a free agent.');
  }
}

export class AmbiguousActivePlayerMembershipError extends InvalidStateTransitionError {
  public readonly code = 'AMBIGUOUS_ACTIVE_PLAYER_MEMBERSHIP';

  public constructor() {
    super(
      'That user has multiple active player memberships. Resolve the roster data conflict before trying again.',
    );
  }
}

export class ActiveStaffRosterConflictError extends ConflictError {
  public readonly code = 'ACTIVE_STAFF_ROSTER_CONFLICT';

  public constructor(action: 'add' | 'remove') {
    super(
      action === 'add'
        ? 'Active team staff cannot be added as an ordinary player. Remove the staff appointment first.'
        : 'Active team staff cannot be removed with /roster remove. Use /staff remove, /demote, or /release as appropriate.',
    );
  }
}

export class MemberNotOnTeamError extends AuthorizationError {
  public readonly code = 'MEMBER_NOT_ON_TEAM';

  public constructor() {
    super('That user is not an active member of the selected team.');
  }
}

export class SelfActionForbiddenError extends AuthorizationError {
  public readonly code = 'SELF_ACTION_FORBIDDEN';

  public constructor() {
    super('You cannot perform this action on yourself.');
  }
}

export class SelfReleaseForbiddenError extends AuthorizationError {
  public readonly code = 'SELF_RELEASE_FORBIDDEN';

  public constructor() {
    super('Use /demand if you want to leave your own team.');
  }
}

export class TargetNotOnCallerTeamError extends AuthorizationError {
  public readonly code = 'TARGET_NOT_ON_CALLER_TEAM';

  public constructor() {
    super('That player is not in your team. You can only release members of your own team.');
  }
}

export class ReleaseTargetIsFreeAgentError extends InvalidStateTransitionError {
  public readonly code = 'RELEASE_TARGET_IS_FREE_AGENT';

  public constructor() {
    super('That user is not currently signed to a team.');
  }
}

export class TeamManagerCannotBeReleasedError extends AuthorizationError {
  public readonly code = 'TEAM_MANAGER_CANNOT_BE_RELEASED';

  public constructor() {
    super('A Team Manager cannot be released. An administrator must remove or replace them.');
  }
}

export class InsufficientStaffRankError extends AuthorizationError {
  public readonly code = 'INSUFFICIENT_STAFF_RANK';

  public constructor() {
    super('Your current staff position cannot perform that action.');
  }
}

export class TargetRankNotManageableError extends AuthorizationError {
  public readonly code = 'TARGET_RANK_NOT_MANAGEABLE';

  public constructor() {
    super("Your staff position cannot manage the target member's current position.");
  }
}

export class TeamManagerCannotDemandError extends AuthorizationError {
  public readonly code = 'TEAM_MANAGER_CANNOT_DEMAND';

  public constructor() {
    super('A Team Manager cannot demand release from their team.');
  }
}

export class StaffSlotOccupiedError extends TeamPositionOccupiedError {
  public readonly code = 'STAFF_SLOT_OCCUPIED';

  public constructor(public readonly staffRole: 'TM' | 'ATM' | 'PM') {
    super(staffRole, 'The selected team');
  }
}

export class TargetNotStaffError extends InvalidStateTransitionError {
  public readonly code = 'TARGET_NOT_STAFF';

  public constructor() {
    super('That roster member does not hold an active staff position.');
  }
}

export class TargetAlreadyDesiredRankError extends ConflictError {
  public readonly code = 'TARGET_ALREADY_DESIRED_RANK';

  public constructor() {
    super('That roster member already holds the selected staff position.');
  }
}

export class InvalidPromotionPathError extends InvalidStateTransitionError {
  public readonly code = 'INVALID_PROMOTION_PATH';

  public constructor() {
    super('That promotion path is not allowed for your staff position.');
  }
}

export class InvalidDemotionTargetError extends InvalidStateTransitionError {
  public readonly code = 'INVALID_DEMOTION_TARGET';

  public constructor() {
    super('Only an Assistant Team Manager or Player Manager can be demoted to player.');
  }
}

export class StaleConfirmationError extends InvalidStateTransitionError {
  public readonly code = 'STALE_CONFIRMATION';

  public constructor() {
    super('This confirmation has expired or is no longer available.');
  }
}

export class ConfirmationAlreadyHandledError extends InvalidStateTransitionError {
  public readonly code = 'CONFIRMATION_ALREADY_HANDLED';

  public constructor() {
    super('This confirmation has already been handled.');
  }
}

export class ConfirmationOwnershipError extends AuthorizationError {
  public readonly code = 'CONFIRMATION_WRONG_USER';

  public constructor() {
    super('Only the user who started this action can use its confirmation buttons.');
  }
}

export class InvalidConfirmationTokenError extends ValidationError {
  public readonly code = 'INVALID_CONFIRMATION_TOKEN';

  public constructor() {
    super('This confirmation button is invalid or has been tampered with.');
  }
}

export class DiscordMemberMissingError extends DomainError {
  public readonly code = 'DISCORD_MEMBER_MISSING';

  public constructor() {
    super('The selected Discord member could not be found in this server.');
  }
}

export class DiscordRoleMissingError extends ConfigurationError {
  public readonly code = 'DISCORD_ROLE_MISSING';

  public constructor(public readonly rolePurpose: 'TEAM' | 'TM' | 'ATM' | 'PM') {
    super(`The configured ${rolePurpose} Discord role is missing.`);
  }
}

export class DiscordManageRolesPermissionError extends AuthorizationError {
  public readonly code = 'DISCORD_MANAGE_ROLES_MISSING';

  public constructor() {
    super('The bot needs the Discord Manage Roles permission to complete this action.');
  }
}

export class DiscordRoleHierarchyError extends AuthorizationError {
  public readonly code = 'DISCORD_ROLE_HIERARCHY';

  public constructor() {
    super(
      'The bot’s highest Discord role must be above the target member’s highest role and every role being added or removed.',
    );
  }
}

export class DiscordRoleNotManageableError extends AuthorizationError {
  public readonly code = 'DISCORD_ROLE_NOT_MANAGEABLE';

  public constructor() {
    super('One of the affected Discord roles is managed by an integration and cannot be changed.');
  }
}

export class DiscordRoleUpdateFailedError extends DomainError {
  public readonly code = 'DISCORD_ROLE_UPDATE_FAILED';

  public constructor(options?: ErrorOptions) {
    super('Discord role synchronization failed; no database success was recorded.', options);
  }
}

export class DiscordRoleCompensationFailedError extends DomainError {
  public readonly code = 'DISCORD_ROLE_COMPENSATION_FAILED';

  public constructor(
    public readonly affectedRolePurposes: readonly string[],
    options?: ErrorOptions,
  ) {
    super(
      'Discord role compensation failed and manual reconciliation is required. A league administrator has been notified in the logs.',
      options,
    );
  }
}

export class StaleMutationStateError extends ConflictError {
  public readonly code = 'STALE_MUTATION_STATE';

  public constructor() {
    super('Roster state changed before the action completed. Refresh and try again.');
  }
}

export class TransferAnnouncementDeliveryError extends DomainError {
  public readonly code = 'TRANSFER_ANNOUNCEMENT_DELIVERY_FAILED';

  public constructor(options?: ErrorOptions) {
    super('The transfer-market announcement could not be delivered.', options);
  }
}

export class AuditAnnouncementDeliveryError extends DomainError {
  public readonly code = 'AUDIT_ANNOUNCEMENT_DELIVERY_FAILED';

  public constructor(options?: ErrorOptions) {
    super('The audit announcement could not be delivered.', options);
  }
}
