import { Prisma } from '@prisma/client';

import {
  ActiveStaffRosterConflictError,
  AdministrativePermissionDeniedError,
  AdministrativeWrongChannelError,
  AlreadyMemberOfClubError,
  AuthorizationError,
  BotPermissionAdminAlreadyGrantedError,
  BotPermissionAdminProtectedError,
  BotPermissionAlreadyGrantedError,
  BotPermissionManagementError,
  BotPermissionNotFoundError,
  BotUserNotAllowedError,
  CallerHasNoStaffAppointmentError,
  ClubInactiveError,
  ConfirmationAlreadyHandledError,
  ConfirmationOwnershipError,
  DemandRateLimitedError,
  DiscordMemberMissingError,
  DiscordRoleCompensationFailedError,
  DiscordRoleUpdateFailedError,
  DuplicateOfferError,
  DuplicateTeamRoleError,
  InactiveSourceTeamError,
  InsufficientStaffRankError,
  InvalidConfirmationTokenError,
  InvalidDemotionTargetError,
  InvalidOfferMessageError,
  InvalidPromotionPathError,
  InvalidTeamEmojiError,
  LastBotPermissionRemovalError,
  MemberAlreadySignedError,
  MemberIsFreeAgentError,
  MemberNotOnTeamError,
  NoStaffAppointmentError,
  NoTeamChangesProvidedError,
  NotCurrentlySignedError,
  OfferExpiredError,
  ReleaseTargetIsFreeAgentError,
  SelfActionForbiddenError,
  SelfReleaseForbiddenError,
  SquadFullError,
  StaffAlreadyAppointedError,
  StaffMemberCannotReceiveOffersError,
  StaffSlotOccupiedError,
  StaleConfirmationError,
  StaleMutationStateError,
  TargetAlreadyDesiredRankError,
  TargetNotOnCallerTeamError,
  TargetNotStaffError,
  TargetRankNotManageableError,
  TeamManagerCannotBeReleasedError,
  TeamManagerCannotDemandError,
  TeamNotFoundError,
  TeamPositionOccupiedError,
  UnauthorizedOfferAcceptanceError,
  ValidationError,
  WrongCommandChannelError,
} from '../domain/errors.js';

export type InteractionErrorLevel = 'info' | 'warn' | 'error';

export interface ClassifiedInteractionError {
  level: InteractionErrorLevel;
  reason: string;
  isInfrastructure: boolean;
}

function discordErrorCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const err = error as Record<string, unknown>;
  if ('code' in err) {
    const code = Number(err['code']);
    if (Number.isFinite(code)) return code;
  }
  return 'cause' in err ? discordErrorCode(err['cause']) : null;
}

export function isUnknownInteractionError(error: unknown): boolean {
  return discordErrorCode(error) === 10_062;
}

function isPrismaError(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientRustPanicError ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientValidationError
  ) {
    return true;
  }
  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>;
    const name = err['name'];
    if (typeof name === 'string' && name.startsWith('Prisma')) return true;
    const code = err['code'];
    if (typeof code === 'string' && code.startsWith('P')) return true;
  }
  return false;
}

function isNetworkError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>;
    const code = err['code'];
    if (
      typeof code === 'string' &&
      [
        'EAI_AGAIN',
        'ENOTFOUND',
        'ECONNRESET',
        'ETIMEDOUT',
        'ECONNREFUSED',
        'EPIPE',
        'EHOSTUNREACH',
        'EHOSTDOWN',
        'ENETUNREACH',
      ].includes(code)
    ) {
      return true;
    }
  }
  return false;
}

function isDiscordAPIError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>;
    const name = err['name'];
    if (name === 'DiscordAPIError') return true;
    const code = discordErrorCode(error);
    if (code !== null && code !== 10_062) return true;
  }
  return false;
}

// Explicit allowlist of expected user/business-rule error classes for INFO level
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const EXPECTED_USER_REJECTION_CLASSES: Array<abstract new (...args: any[]) => any> = [
  // Channel Rejections (explicit exceptions to ConfigurationError)
  WrongCommandChannelError,
  AdministrativeWrongChannelError,

  // Authorization / Permission Rejections
  AdministrativePermissionDeniedError,
  CallerHasNoStaffAppointmentError,
  DemandRateLimitedError,
  MemberNotOnTeamError,
  SelfActionForbiddenError,
  SelfReleaseForbiddenError,
  TargetNotOnCallerTeamError,
  TeamManagerCannotBeReleasedError,
  InsufficientStaffRankError,
  TargetRankNotManageableError,
  TeamManagerCannotDemandError,
  ConfirmationOwnershipError,
  AuthorizationError,

  // Validation Rejections
  NoTeamChangesProvidedError,
  InvalidConfirmationTokenError,
  ValidationError,

  // Squad / Signing / Roster Rejections
  SquadFullError,
  MemberAlreadySignedError,
  MemberIsFreeAgentError,
  ReleaseTargetIsFreeAgentError,
  NotCurrentlySignedError,
  AlreadyMemberOfClubError,
  ActiveStaffRosterConflictError,

  // Staff / Position Rejections
  StaffAlreadyAppointedError,
  StaffMemberCannotReceiveOffersError,
  StaffSlotOccupiedError,
  TeamPositionOccupiedError,
  TargetNotStaffError,
  TargetAlreadyDesiredRankError,
  InvalidPromotionPathError,
  InvalidDemotionTargetError,
  NoStaffAppointmentError,

  // Offer Rejections
  DuplicateOfferError,
  OfferExpiredError,
  UnauthorizedOfferAcceptanceError,
  InvalidOfferMessageError,

  // Team / Club / Emoji Rejections
  TeamNotFoundError,
  DuplicateTeamRoleError,
  InvalidTeamEmojiError,
  ClubInactiveError,
  InactiveSourceTeamError,

  // Bot User / Discord Member Rejections
  BotUserNotAllowedError,
  DiscordMemberMissingError,

  // Bot Permission Management Rejections
  BotPermissionAlreadyGrantedError,
  BotPermissionAdminAlreadyGrantedError,
  BotPermissionAdminProtectedError,
  BotPermissionNotFoundError,
  LastBotPermissionRemovalError,
  BotPermissionManagementError,
];

export function isExpectedInteractionRejection(error: unknown): boolean {
  return EXPECTED_USER_REJECTION_CLASSES.some((cls) => error instanceof cls);
}

export function extractErrorReason(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const err = error as Record<string, unknown>;
    if ('code' in err && typeof err['code'] === 'string') {
      return err['code'];
    }
    if ('code' in err && typeof err['code'] === 'number') {
      return String(err['code']);
    }
    const constructorName = err.constructor?.name;
    if (constructorName && constructorName !== 'Object') {
      return constructorName;
    }
    if ('name' in err && typeof err['name'] === 'string') {
      return err['name'];
    }
  }
  return typeof error === 'string' ? error : 'UNKNOWN_ERROR';
}

export function classifyInteractionError(error: unknown): ClassifiedInteractionError {
  const reason = extractErrorReason(error);

  // 1. Discord 10062 (Interaction Expired) -> WARN
  if (isUnknownInteractionError(error)) {
    return {
      level: 'warn',
      reason: 'INTERACTION_EXPIRED',
      isInfrastructure: false,
    };
  }

  // 2. Specific Operational Warnings -> WARN
  if (
    error instanceof StaleConfirmationError ||
    error instanceof ConfirmationAlreadyHandledError ||
    error instanceof StaleMutationStateError
  ) {
    return {
      level: 'warn',
      reason,
      isInfrastructure: false,
    };
  }

  // 3. Infrastructure & System Failures -> ERROR
  if (
    error instanceof DiscordRoleCompensationFailedError ||
    error instanceof DiscordRoleUpdateFailedError ||
    isPrismaError(error) ||
    isDiscordAPIError(error) ||
    isNetworkError(error)
  ) {
    return {
      level: 'error',
      reason,
      isInfrastructure: true,
    };
  }

  // 4. Expected User / Business-Rule Rejections -> INFO
  if (isExpectedInteractionRejection(error)) {
    return {
      level: 'info',
      reason,
      isInfrastructure: false,
    };
  }

  // 5. Fail Closed -> ERROR for everything else (ConfigurationError base, delivery errors, TypeError, unknown errors, etc.)
  return {
    level: 'error',
    reason,
    isInfrastructure: true,
  };
}
