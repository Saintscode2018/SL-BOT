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

export class DebugAdministratorPermissionRequiredError extends AuthorizationError {
  public constructor() {
    super('Discord Administrator permission is required to use /debugreset.');
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
    public readonly guidance: 'bot_commands' | 'global',
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

export class DuplicateOfferError extends DomainError {}

export class BotUserNotAllowedError extends DomainError {}

export class OfferDeliveryError extends DomainError {}

export class InvalidOfferMessageError extends DomainError {}

export class DuplicateTeamRoleError extends ConflictError {
  public constructor(
    public readonly roleId: string,
    public readonly teamName: string,
  ) {
    super(`The role <@&${roleId}> is already assigned to ${teamName}.`);
  }
}

export class DuplicateTeamNameError extends ConflictError {
  public constructor(public readonly teamName: string) {
    super(`A team named ${teamName} already exists.`);
  }
}

export class DuplicateTeamShortNameError extends ConflictError {
  public constructor(
    public readonly shortName: string,
    public readonly teamName: string,
  ) {
    super(`The abbreviation ${shortName} is already assigned to ${teamName}.`);
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

export class TeamPositionOccupiedError extends ConflictError {
  public constructor(
    public readonly positionName: string,
    public readonly teamName: string,
    public readonly currentHolderUserId: string,
  ) {
    super(
      `${teamName} already has a ${positionName}: <@${currentHolderUserId}>.\n\nRemove the current ${positionName} before appointing another one.`,
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

export class InvalidBannerConfigurationError extends ValidationError {
  public constructor() {
    super('At least one team banner component must be enabled.');
  }
}

export class NoStaffAppointmentError extends DomainError {
  public constructor() {
    super(
      'You must be an active Team Manager, Assistant Team Manager, or Player Manager of a team to issue contract offers.',
    );
  }
}
