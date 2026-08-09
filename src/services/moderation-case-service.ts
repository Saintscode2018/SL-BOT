import type { PrismaClient } from '@prisma/client';

import { moderationCaseTypeSchema, type ModerationCaseType } from '../domain/enums.js';
import {
  InvalidBailError,
  InvalidModerationDurationError,
  InvalidModerationReasonError,
  InvalidModerationTimestampError,
  ModerationCaseAlreadyActiveError,
  ModerationCaseNotActiveError,
} from '../domain/errors.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import {
  ModerationCaseRepository,
  type ModerationCaseWithUsers,
} from '../repositories/moderation-case-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import type { AuthorizationInput } from './authorization-service.js';
import { AuthorizationService } from './authorization-service.js';

const maximumPrismaInteger = 2_147_483_647;
export const maximumModerationReasonLength = 1000;

export interface CreateModerationCaseInput {
  authorization: AuthorizationInput;
  targetDiscordUserId: string;
  type: ModerationCaseType;
  reason?: string | null;
  bail: number;
  durationSeconds?: number | null;
  issuedAt?: Date;
}

export interface ResolveModerationCaseInput {
  authorization: AuthorizationInput;
  targetDiscordUserId: string;
  type: ModerationCaseType;
  reason?: string | null;
  resolvedAt?: Date;
}

export interface FindModerationCaseInput {
  authorization: AuthorizationInput;
  targetDiscordUserId: string;
  type: ModerationCaseType;
}

export interface ListModerationCasesInput {
  authorization: AuthorizationInput;
  targetDiscordUserId: string;
}

function normalizeReason(reason: string | null | undefined): string | null {
  if (reason === null || reason === undefined) return null;
  const normalized = reason.trim();
  if (normalized.length === 0) return null;
  if (normalized.length > maximumModerationReasonLength) {
    throw new InvalidModerationReasonError();
  }
  return normalized;
}

function validateBail(bail: number): void {
  if (!Number.isInteger(bail) || bail < 0 || bail > maximumPrismaInteger) {
    throw new InvalidBailError();
  }
}

function validateDate(value: Date, label: string): void {
  if (!Number.isFinite(value.getTime())) {
    throw new InvalidModerationTimestampError(`${label} must be a valid date.`);
  }
}

function normalizeDuration(
  type: ModerationCaseType,
  durationSeconds: number | null | undefined,
  issuedAt: Date,
): { durationSeconds: number | null; expiresAt: Date | null } {
  if (type !== 'MUTE') {
    if (durationSeconds !== null && durationSeconds !== undefined) {
      throw new InvalidModerationDurationError(`${type} cases cannot have a duration.`);
    }
    return { durationSeconds: null, expiresAt: null };
  }
  if (
    durationSeconds === null ||
    durationSeconds === undefined ||
    !Number.isInteger(durationSeconds) ||
    durationSeconds <= 0 ||
    durationSeconds > maximumPrismaInteger
  ) {
    throw new InvalidModerationDurationError();
  }
  const expiresAt = new Date(issuedAt.getTime() + durationSeconds * 1000);
  validateDate(expiresAt, 'Mute expiry');
  return { durationSeconds, expiresAt };
}

export class ModerationCaseService {
  public constructor(private readonly database: PrismaClient) {}

  public async createCase(input: CreateModerationCaseInput): Promise<ModerationCaseWithUsers> {
    const type = moderationCaseTypeSchema.parse(input.type);
    const reason = normalizeReason(input.reason);
    validateBail(input.bail);
    const issuedAt = input.issuedAt ?? new Date();
    validateDate(issuedAt, 'Issue time');
    const duration = normalizeDuration(type, input.durationSeconds, issuedAt);

    return this.database.$transaction(async (transaction) => {
      const guilds = new GuildRepository(transaction);
      await guilds.acquireWriteLock(input.authorization.discordGuildId);
      const authorization = await new AuthorizationService(transaction).authorizeModeration(
        input.authorization,
      );
      const users = new UserRepository(transaction);
      const target = await users.getOrCreateByDiscordUserId(input.targetDiscordUserId);
      const issuer = await users.getOrCreateByDiscordUserId(input.authorization.discordUserId);
      const cases = new ModerationCaseRepository(transaction);
      if ((await cases.getActiveForUserAndType(authorization.guild.id, target.id, type)) !== null) {
        throw new ModerationCaseAlreadyActiveError(type);
      }
      const caseNumber = await cases.allocateNextCaseNumber(authorization.guild.id);
      return cases.create({
        guildId: authorization.guild.id,
        caseNumber,
        targetUserId: target.id,
        issuedByUserId: issuer.id,
        type,
        reason,
        bail: input.bail,
        durationSeconds: duration.durationSeconds,
        expiresAt: duration.expiresAt,
        issuedAt,
      });
    });
  }

  public async resolveCase(input: ResolveModerationCaseInput): Promise<ModerationCaseWithUsers> {
    const type = moderationCaseTypeSchema.parse(input.type);
    const resolutionReason = normalizeReason(input.reason);
    const resolvedAt = input.resolvedAt ?? new Date();
    validateDate(resolvedAt, 'Resolution time');

    return this.database.$transaction(async (transaction) => {
      const guilds = new GuildRepository(transaction);
      await guilds.acquireWriteLock(input.authorization.discordGuildId);
      const authorization = await new AuthorizationService(transaction).authorizeModeration(
        input.authorization,
      );
      const users = new UserRepository(transaction);
      const target = await users.getByDiscordUserId(input.targetDiscordUserId);
      if (target === null) throw new ModerationCaseNotActiveError(type);
      const cases = new ModerationCaseRepository(transaction);
      const active = await cases.getActiveForUserAndType(authorization.guild.id, target.id, type);
      if (active === null) throw new ModerationCaseNotActiveError(type);
      if (resolvedAt.getTime() < active.issuedAt.getTime()) {
        throw new InvalidModerationTimestampError(
          'Resolution time cannot be earlier than the case issue time.',
        );
      }
      const resolver = await users.getOrCreateByDiscordUserId(input.authorization.discordUserId);
      const resolved = await cases.resolveActiveManually(active.id, {
        resolvedByUserId: resolver.id,
        resolutionReason,
        resolvedAt,
      });
      if (resolved === null) throw new ModerationCaseNotActiveError(type);
      return resolved;
    });
  }

  public async getActiveCase(
    input: FindModerationCaseInput,
  ): Promise<ModerationCaseWithUsers | null> {
    const type = moderationCaseTypeSchema.parse(input.type);
    const authorization = await new AuthorizationService(this.database).authorizeModeration(
      input.authorization,
    );
    const target = await new UserRepository(this.database).getByDiscordUserId(
      input.targetDiscordUserId,
    );
    if (target === null) return null;
    return new ModerationCaseRepository(this.database).getActiveForUserAndType(
      authorization.guild.id,
      target.id,
      type,
    );
  }

  public async listUserCases(input: ListModerationCasesInput): Promise<ModerationCaseWithUsers[]> {
    const authorization = await new AuthorizationService(this.database).authorizeModeration(
      input.authorization,
    );
    const target = await new UserRepository(this.database).getByDiscordUserId(
      input.targetDiscordUserId,
    );
    if (target === null) return [];
    return new ModerationCaseRepository(this.database).listForUser(
      authorization.guild.id,
      target.id,
    );
  }
}
