import type { ModerationCase, Prisma } from '@prisma/client';

import {
  moderationCaseResolutionTypeSchema,
  moderationCaseStatusSchema,
  moderationCaseTypeSchema,
  type ModerationCaseType,
} from '../domain/enums.js';
import type { DatabaseClient } from '../domain/types.js';
import { translateDatabaseError } from './repository-errors.js';

export type ModerationCaseWithUsers = Prisma.ModerationCaseGetPayload<{
  include: { target: true; issuedBy: true; resolvedBy: true };
}>;

export interface CreateModerationCaseInput {
  guildId: string;
  caseNumber: number;
  targetUserId: string;
  issuedByUserId: string;
  type: ModerationCaseType;
  reason: string | null;
  bail: number;
  durationSeconds: number | null;
  expiresAt: Date | null;
  issuedAt: Date;
}

export interface ResolveManualModerationCaseInput {
  resolvedByUserId: string;
  resolutionReason: string | null;
  resolvedAt: Date;
}

const moderationCaseUsers = {
  target: true,
  issuedBy: true,
  resolvedBy: true,
} as const;

export class ModerationCaseRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public async allocateNextCaseNumber(guildId: string): Promise<number> {
    const counter = await this.db.moderationCaseCounter.upsert({
      where: { guildId },
      create: { guildId, nextCaseNumber: 2 },
      update: { nextCaseNumber: { increment: 1 } },
    });
    return counter.nextCaseNumber - 1;
  }

  public async create(input: CreateModerationCaseInput): Promise<ModerationCaseWithUsers> {
    try {
      return await this.db.moderationCase.create({
        data: {
          guildId: input.guildId,
          caseNumber: input.caseNumber,
          targetUserId: input.targetUserId,
          issuedByUserId: input.issuedByUserId,
          type: moderationCaseTypeSchema.parse(input.type),
          reason: input.reason,
          bail: input.bail,
          durationSeconds: input.durationSeconds,
          expiresAt: input.expiresAt,
          issuedAt: input.issuedAt,
          status: moderationCaseStatusSchema.parse('ACTIVE'),
        },
        include: moderationCaseUsers,
      });
    } catch (error: unknown) {
      return translateDatabaseError(error, 'create moderation case');
    }
  }

  public async getActiveForUserAndType(
    guildId: string,
    targetUserId: string,
    type: ModerationCaseType,
  ): Promise<ModerationCaseWithUsers | null> {
    return this.db.moderationCase.findFirst({
      where: {
        guildId,
        targetUserId,
        type: moderationCaseTypeSchema.parse(type),
        status: moderationCaseStatusSchema.parse('ACTIVE'),
      },
      include: moderationCaseUsers,
    });
  }

  public async resolveActiveManually(
    id: string,
    input: ResolveManualModerationCaseInput,
  ): Promise<ModerationCaseWithUsers | null> {
    const result = await this.db.moderationCase.updateMany({
      where: { id, status: moderationCaseStatusSchema.parse('ACTIVE') },
      data: {
        status: moderationCaseStatusSchema.parse('RESOLVED'),
        resolutionType: moderationCaseResolutionTypeSchema.parse('MANUAL'),
        resolvedByUserId: input.resolvedByUserId,
        resolutionReason: input.resolutionReason,
        resolvedAt: input.resolvedAt,
      },
    });
    if (result.count !== 1) return null;
    return this.db.moderationCase.findUnique({
      where: { id },
      include: moderationCaseUsers,
    });
  }

  public async resolveExpiredMute(
    id: string,
    resolvedAt: Date,
  ): Promise<ModerationCaseWithUsers | null> {
    const result = await this.db.moderationCase.updateMany({
      where: {
        id,
        type: moderationCaseTypeSchema.parse('MUTE'),
        status: moderationCaseStatusSchema.parse('ACTIVE'),
        expiresAt: { lte: resolvedAt },
      },
      data: {
        status: moderationCaseStatusSchema.parse('RESOLVED'),
        resolutionType: moderationCaseResolutionTypeSchema.parse('EXPIRED'),
        resolvedByUserId: null,
        resolutionReason: null,
        resolvedAt,
      },
    });
    if (result.count !== 1) return null;
    return this.db.moderationCase.findUnique({
      where: { id },
      include: moderationCaseUsers,
    });
  }

  public async listForUser(
    guildId: string,
    targetUserId: string,
  ): Promise<ModerationCaseWithUsers[]> {
    return this.db.moderationCase.findMany({
      where: { guildId, targetUserId },
      include: moderationCaseUsers,
      orderBy: [{ caseNumber: 'desc' }],
    });
  }

  public async countForGuild(guildId: string): Promise<number> {
    return this.db.moderationCase.count({ where: { guildId } });
  }

  public async getById(id: string): Promise<ModerationCase | null> {
    return this.db.moderationCase.findUnique({ where: { id } });
  }
}
