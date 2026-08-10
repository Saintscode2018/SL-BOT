import type { PrismaClient } from '@prisma/client';

import {
  BotUserNotAllowedError,
  InvalidModerationDurationError,
  ModerationBotPermissionError,
  ModerationCaseAlreadyActiveError,
  ModerationCaseNotActiveError,
  ModerationChannelNotConfiguredError,
  ModerationCompensationFailedError,
  ModerationExistingTimeoutLongerError,
  ModerationSelfTargetError,
  ModerationTargetNotModeratableError,
  ModerationTimeoutChangedError,
  ModerationTimeoutTooLongError,
} from '../domain/errors.js';
import { maximumDiscordTimeoutSeconds } from '../domain/moderation-duration.js';
import type { Logger } from '../logging/logger.js';
import type { ModerationCaseWithUsers } from '../repositories/moderation-case-repository.js';
import type { AuthorizationInput } from './authorization-service.js';
import { AuthorizationService } from './authorization-service.js';
import type { ModerationAnnouncementPublisher } from './moderation-announcement-service.js';
import { ModerationCaseService } from './moderation-case-service.js';

export interface ModerationMemberSnapshot {
  targetIsBot: boolean;
  targetIsSelf: boolean;
  targetModeratable: boolean;
  botHasModerateMembers: boolean;
  timeoutUntil: Date | null;
}

export type ModerationTimeoutRemovalResult = 'REMOVED' | 'ABSENT' | 'MISMATCH';

export interface ModerationTimeoutGateway {
  inspect(discordGuildId: string, targetDiscordUserId: string): Promise<ModerationMemberSnapshot>;
  applyTimeout(
    discordGuildId: string,
    targetDiscordUserId: string,
    expiresAt: Date,
    reason: string,
  ): Promise<void>;
  removeTimeoutIfExpiresAtMatches(
    discordGuildId: string,
    targetDiscordUserId: string,
    expectedExpiresAt: Date,
    activeAt: Date,
    reason: string,
  ): Promise<ModerationTimeoutRemovalResult>;
  restoreTimeout(
    discordGuildId: string,
    targetDiscordUserId: string,
    timeoutUntil: Date | null,
    reason: string,
  ): Promise<void>;
}

interface ModerationCaseGateway {
  createCase: ModerationCaseService['createCase'];
  resolveCase: ModerationCaseService['resolveCase'];
  resolveExpiredMute: ModerationCaseService['resolveExpiredMute'];
  getActiveCase: ModerationCaseService['getActiveCase'];
}

interface ModerationAuthorizationGateway {
  authorizeModeration: AuthorizationService['authorizeModeration'];
}

export interface MuteExecutionInput {
  authorization: AuthorizationInput;
  targetDiscordUserId: string;
  reason?: string | null;
  bail: number;
  durationSeconds: number;
  issuedAt?: Date;
}

export interface UnmuteExecutionInput {
  authorization: AuthorizationInput;
  targetDiscordUserId: string;
  reason?: string | null;
  resolvedAt?: Date;
}

export interface ModerationMuteExecutionResult {
  moderationCase: ModerationCaseWithUsers;
  caseFilesDelivered: boolean;
  auditDelivered: boolean;
}

function validateMember(snapshot: ModerationMemberSnapshot): void {
  if (snapshot.targetIsSelf) throw new ModerationSelfTargetError();
  if (snapshot.targetIsBot) throw new BotUserNotAllowedError('bots cannot be muted');
  if (!snapshot.botHasModerateMembers) throw new ModerationBotPermissionError();
  if (!snapshot.targetModeratable) throw new ModerationTargetNotModeratableError();
}

function previousActiveTimeout(snapshot: ModerationMemberSnapshot, now: Date): Date | null {
  return snapshot.timeoutUntil !== null && snapshot.timeoutUntil.getTime() > now.getTime()
    ? snapshot.timeoutUntil
    : null;
}

export class ModerationMuteService {
  private readonly activeOperations = new Map<string, Promise<void>>();

  public constructor(
    database: PrismaClient,
    private readonly timeouts: ModerationTimeoutGateway,
    private readonly announcements: ModerationAnnouncementPublisher,
    private readonly logger: Logger,
    private readonly cases: ModerationCaseGateway = new ModerationCaseService(database),
    private readonly authorization: ModerationAuthorizationGateway = new AuthorizationService(
      database,
    ),
    private readonly now: () => Date = () => new Date(),
  ) {}

  public mute(input: MuteExecutionInput): Promise<ModerationMuteExecutionResult> {
    return this.runExclusive(input, () => this.performMute(input));
  }

  public unmute(input: UnmuteExecutionInput): Promise<ModerationMuteExecutionResult> {
    return this.runExclusive(input, () => this.performUnmute(input));
  }

  private async performMute(input: MuteExecutionInput): Promise<ModerationMuteExecutionResult> {
    if (!Number.isInteger(input.durationSeconds) || input.durationSeconds <= 0) {
      throw new InvalidModerationDurationError();
    }
    if (input.durationSeconds > maximumDiscordTimeoutSeconds) {
      throw new ModerationTimeoutTooLongError(maximumDiscordTimeoutSeconds);
    }
    const channels = await this.requireLoggingChannels(input.authorization);
    const issuedAt = input.issuedAt ?? this.now();
    const active = await this.cases.getActiveCase({
      authorization: input.authorization,
      targetDiscordUserId: input.targetDiscordUserId,
      type: 'MUTE',
    });
    if (active !== null) {
      if (active.expiresAt === null || active.expiresAt.getTime() > issuedAt.getTime()) {
        throw new ModerationCaseAlreadyActiveError('MUTE');
      }
      await this.cases.resolveExpiredMute({
        authorization: input.authorization,
        targetDiscordUserId: input.targetDiscordUserId,
        resolvedAt: issuedAt,
      });
    }

    const member = await this.timeouts.inspect(
      input.authorization.discordGuildId,
      input.targetDiscordUserId,
    );
    validateMember(member);
    const expiresAt = new Date(issuedAt.getTime() + input.durationSeconds * 1000);
    const priorTimeout = previousActiveTimeout(member, issuedAt);
    if (priorTimeout !== null && priorTimeout.getTime() > expiresAt.getTime()) {
      throw new ModerationExistingTimeoutLongerError();
    }
    await this.timeouts.applyTimeout(
      input.authorization.discordGuildId,
      input.targetDiscordUserId,
      expiresAt,
      `SL Bot /mute by ${input.authorization.discordUserId}`,
    );

    let moderationCase: ModerationCaseWithUsers;
    try {
      moderationCase = await this.cases.createCase({
        authorization: input.authorization,
        targetDiscordUserId: input.targetDiscordUserId,
        type: 'MUTE',
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        bail: input.bail,
        durationSeconds: input.durationSeconds,
        issuedAt,
      });
    } catch (databaseError: unknown) {
      await this.compensateMuteFailure(input, priorTimeout, databaseError);
      throw databaseError;
    }

    const delivery = await this.announcements.publish({
      operation: 'MUTE',
      discordGuildId: input.authorization.discordGuildId,
      caseFilesChannelId: channels.caseFilesChannelId,
      auditChannelId: channels.auditChannelId,
      targetDiscordUserId: input.targetDiscordUserId,
      actorDiscordUserId: input.authorization.discordUserId,
      caseNumber: moderationCase.caseNumber,
      reason: moderationCase.reason,
      durationSeconds: moderationCase.durationSeconds,
      bail: moderationCase.bail,
      occurredAt: moderationCase.issuedAt,
    });
    return { moderationCase, ...delivery };
  }

  private async performUnmute(input: UnmuteExecutionInput): Promise<ModerationMuteExecutionResult> {
    const channels = await this.requireLoggingChannels(input.authorization);
    const active = await this.cases.getActiveCase({
      authorization: input.authorization,
      targetDiscordUserId: input.targetDiscordUserId,
      type: 'MUTE',
    });
    if (active === null) {
      throw new ModerationCaseNotActiveError('MUTE');
    }

    const member = await this.timeouts.inspect(
      input.authorization.discordGuildId,
      input.targetDiscordUserId,
    );
    validateMember(member);
    const resolvedAt = input.resolvedAt ?? this.now();
    const timeoutRemovalResult =
      active.expiresAt === null
        ? 'ABSENT'
        : await this.timeouts.removeTimeoutIfExpiresAtMatches(
            input.authorization.discordGuildId,
            input.targetDiscordUserId,
            active.expiresAt,
            resolvedAt,
            `SL Bot /unmute case ${active.caseNumber} by ${input.authorization.discordUserId}`,
          );
    if (timeoutRemovalResult === 'MISMATCH') {
      throw new ModerationTimeoutChangedError();
    }

    let moderationCase: ModerationCaseWithUsers;
    try {
      moderationCase = await this.cases.resolveCase({
        authorization: input.authorization,
        targetDiscordUserId: input.targetDiscordUserId,
        type: 'MUTE',
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        resolvedAt,
      });
    } catch (databaseError: unknown) {
      if (timeoutRemovalResult === 'REMOVED') {
        await this.compensateUnmuteFailure(input, active, databaseError);
      }
      throw databaseError;
    }

    const delivery = await this.announcements.publish({
      operation: 'UNMUTE',
      discordGuildId: input.authorization.discordGuildId,
      caseFilesChannelId: channels.caseFilesChannelId,
      auditChannelId: channels.auditChannelId,
      targetDiscordUserId: input.targetDiscordUserId,
      actorDiscordUserId: input.authorization.discordUserId,
      caseNumber: moderationCase.caseNumber,
      reason: moderationCase.resolutionReason,
      durationSeconds: null,
      bail: null,
      occurredAt: moderationCase.resolvedAt!,
    });
    return { moderationCase, ...delivery };
  }

  private async requireLoggingChannels(authorizationInput: AuthorizationInput): Promise<{
    caseFilesChannelId: string;
    auditChannelId: string;
  }> {
    const { settings } = await this.authorization.authorizeModeration(authorizationInput);
    if (settings.caseFilesChannelId === null) {
      throw new ModerationChannelNotConfiguredError('CASE_FILES');
    }
    if (settings.auditChannelId === null) {
      throw new ModerationChannelNotConfiguredError('AUDIT');
    }
    return {
      caseFilesChannelId: settings.caseFilesChannelId,
      auditChannelId: settings.auditChannelId,
    };
  }

  private async compensateMuteFailure(
    input: MuteExecutionInput,
    priorTimeout: Date | null,
    databaseError: unknown,
  ): Promise<void> {
    try {
      await this.timeouts.restoreTimeout(
        input.authorization.discordGuildId,
        input.targetDiscordUserId,
        priorTimeout,
        'SL Bot /mute database compensation',
      );
    } catch (compensationError: unknown) {
      this.logCompensationFailure('MUTE', input, databaseError, compensationError);
      throw new ModerationCompensationFailedError({
        cause: new AggregateError(
          [databaseError, compensationError],
          'mute database mutation and Discord compensation failed',
        ),
      });
    }
  }

  private async compensateUnmuteFailure(
    input: UnmuteExecutionInput,
    active: ModerationCaseWithUsers,
    databaseError: unknown,
  ): Promise<void> {
    const expiry = active.expiresAt;
    if (expiry === null || expiry.getTime() <= this.now().getTime()) {
      this.logger.warn(
        'unmute database mutation failed after timeout expiry; restoration skipped',
        {
          commandName: 'unmute',
          guildId: input.authorization.discordGuildId,
          actorDiscordUserId: input.authorization.discordUserId,
          targetDiscordUserId: input.targetDiscordUserId,
          caseNumber: active.caseNumber,
          operation: 'UNMUTE_COMPENSATION',
        },
      );
      return;
    }
    try {
      await this.timeouts.restoreTimeout(
        input.authorization.discordGuildId,
        input.targetDiscordUserId,
        expiry,
        `SL Bot /unmute database compensation for case ${active.caseNumber}`,
      );
    } catch (compensationError: unknown) {
      this.logCompensationFailure(
        'UNMUTE',
        input,
        databaseError,
        compensationError,
        active.caseNumber,
      );
      throw new ModerationCompensationFailedError({
        cause: new AggregateError(
          [databaseError, compensationError],
          'unmute database mutation and Discord compensation failed',
        ),
      });
    }
  }

  private logCompensationFailure(
    operation: 'MUTE' | 'UNMUTE',
    input: MuteExecutionInput | UnmuteExecutionInput,
    originalError: unknown,
    compensationError: unknown,
    caseNumber?: number,
  ): void {
    this.logger.error('moderation mutation and Discord compensation both failed', originalError, {
      commandName: operation === 'MUTE' ? 'mute' : 'unmute',
      guildId: input.authorization.discordGuildId,
      actorDiscordUserId: input.authorization.discordUserId,
      targetDiscordUserId: input.targetDiscordUserId,
      caseNumber,
      operation: `${operation}_COMPENSATION`,
      compensationError,
    });
  }

  private async runExclusive<T>(
    input: Pick<MuteExecutionInput, 'authorization' | 'targetDiscordUserId'>,
    action: () => Promise<T>,
  ): Promise<T> {
    const key = `${input.authorization.discordGuildId}:${input.targetDiscordUserId}`;
    const previous = this.activeOperations.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => gate);
    this.activeOperations.set(key, queued);
    await previous.catch(() => undefined);
    try {
      return await action();
    } finally {
      release();
      if (this.activeOperations.get(key) === queued) this.activeOperations.delete(key);
    }
  }
}
