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
