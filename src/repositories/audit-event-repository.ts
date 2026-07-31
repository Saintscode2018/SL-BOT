import type { AuditEvent } from '@prisma/client';

import type { DatabaseClient, JsonInput } from '../domain/types.js';
import { translateDatabaseError } from './repository-errors.js';

export interface CreateAuditEventInput {
  guildId: string;
  actorUserId?: string | null;
  eventType: string;
  entityType: string;
  entityId: string;
  beforeState?: JsonInput;
  afterState?: JsonInput;
  metadata?: JsonInput;
}

export class AuditEventRepository {
  public constructor(private readonly db: DatabaseClient) {}

  public async create(input: CreateAuditEventInput): Promise<AuditEvent> {
    try {
      return await this.db.auditEvent.create({
        data: {
          guildId: input.guildId,
          actorUserId: input.actorUserId ?? null,
          eventType: input.eventType,
          entityType: input.entityType,
          entityId: input.entityId,
          ...(input.beforeState === undefined ? {} : { beforeState: input.beforeState }),
          ...(input.afterState === undefined ? {} : { afterState: input.afterState }),
          ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        },
      });
    } catch (error: unknown) {
      return translateDatabaseError(error, 'create audit event');
    }
  }

  public async listForGuild(guildId: string): Promise<AuditEvent[]> {
    return this.db.auditEvent.findMany({
      where: { guildId },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  public async listForEntity(entityType: string, entityId: string): Promise<AuditEvent[]> {
    return this.db.auditEvent.findMany({
      where: { entityType, entityId },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  public async listByActor(actorUserId: string): Promise<AuditEvent[]> {
    return this.db.auditEvent.findMany({
      where: { actorUserId },
      orderBy: [{ createdAt: 'desc' }],
    });
  }
}
