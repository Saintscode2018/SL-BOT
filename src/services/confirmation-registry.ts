import { randomUUID } from 'node:crypto';

import {
  ConfirmationAlreadyHandledError,
  ConfirmationOwnershipError,
  InvalidConfirmationTokenError,
  StaleConfirmationError,
} from '../domain/errors.js';
import type { Logger } from '../logging/logger.js';

export type ConfirmationActionType =
  | 'DEMAND'
  | 'RELEASE'
  | 'PROMOTE'
  | 'DEMOTE'
  | 'DISBAND'
  | 'SWAP';
export type ConfirmationTerminalState = 'CONSUMED' | 'CANCELLED' | 'EXPIRED';

export interface ConfirmationContext {
  action: ConfirmationActionType;
  commandName: string;
  discordGuildId: string;
  initiatorDiscordUserId: string;
  teamId: string;
  team2Id?: string;
  targetDiscordUserId?: string;
  initiatorStaffRole?: 'TM' | 'ATM' | 'PM';
  targetStaffRole?: 'TM' | 'ATM' | 'PM';
  destinationStaffRole?: 'TM' | 'ATM' | 'PM';
}

export type ConfirmationDecision = 'confirm' | 'staff-only';

export interface ConfirmationRegistration {
  id: string;
  confirmCustomId: string;
  staffOnlyCustomId: string;
  cancelCustomId: string;
  expiresAt: Date;
}

interface ConfirmationRecord extends ConfirmationContext {
  id: string;
  expiresAt: Date;
  status: 'PENDING' | ConfirmationTerminalState;
  timer: NodeJS.Timeout;
  cleanupTimer?: NodeJS.Timeout;
  onExpire?: () => Promise<void>;
  onCancel?: () => Promise<void>;
}

const confirmationCustomIdPattern =
  /^[a-z0-9-]+:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):(confirm|staff-only|cancel)$/i;

export const confirmationLifetimeMs = 2 * 60 * 1000;

export class ConfirmationRegistry {
  private readonly records = new Map<string, ConfirmationRecord>();

  public constructor(
    private readonly logger: Logger,
    private readonly lifetimeMs = confirmationLifetimeMs,
  ) {}

  public create(
    context: ConfirmationContext,
    options: {
      prefix?: string;
      now?: Date;
      onExpire?: () => Promise<void>;
      onCancel?: () => Promise<void>;
    } = {},
  ): ConfirmationRegistration {
    const id = randomUUID();
    const prefix = options.prefix ?? 'roster-confirm';
    const now = options.now ?? new Date();
    const expiresAt = new Date(now.getTime() + this.lifetimeMs);
    const timer = setTimeout(() => this.expire(id), this.lifetimeMs);
    timer.unref();
    this.records.set(id, {
      ...context,
      id,
      expiresAt,
      status: 'PENDING',
      timer,
      ...(options.onExpire === undefined ? {} : { onExpire: options.onExpire }),
      ...(options.onCancel === undefined ? {} : { onCancel: options.onCancel }),
    });
    return {
      id,
      confirmCustomId: `${prefix}:${id}:confirm`,
      staffOnlyCustomId: `${prefix}:${id}:staff-only`,
      cancelCustomId: `${prefix}:${id}:cancel`,
      expiresAt,
    };
  }

  public consume(customId: string, discordUserId: string, now = new Date()): ConfirmationContext {
    const record = this.resolve(customId, discordUserId, now, ['confirm']);
    this.markTerminal(record, 'CONSUMED');
    return this.context(record);
  }

  public consumeDecision(
    customId: string,
    discordUserId: string,
    now = new Date(),
    discordGuildId?: string,
  ): { context: ConfirmationContext; decision: ConfirmationDecision } {
    const record = this.resolve(customId, discordUserId, now, ['confirm', 'staff-only']);
    if (discordGuildId !== undefined && record.discordGuildId !== discordGuildId) {
      throw new StaleConfirmationError();
    }
    const decision = customId.endsWith(':staff-only') ? 'staff-only' : 'confirm';
    this.markTerminal(record, 'CONSUMED');
    return { context: this.context(record), decision };
  }

  public async consumeAndExecute<T>(
    customId: string,
    discordUserId: string,
    executeWithFreshAuthorization: (context: ConfirmationContext) => Promise<T>,
    now = new Date(),
  ): Promise<T> {
    const context = this.consume(customId, discordUserId, now);
    return executeWithFreshAuthorization(context);
  }

  public cancel(
    customId: string,
    discordUserId: string,
    now = new Date(),
    discordGuildId?: string,
  ): ConfirmationContext {
    const record = this.resolve(customId, discordUserId, now, ['cancel']);
    if (discordGuildId !== undefined && record.discordGuildId !== discordGuildId) {
      throw new StaleConfirmationError();
    }
    this.markTerminal(record, 'CANCELLED');
    if (record.onCancel !== undefined) {
      const onCancel = record.onCancel;
      queueMicrotask(() => {
        void onCancel().catch((error: unknown) => {
          this.logger.warn('confirmation cancel response could not be updated', {
            confirmationId: record.id,
            error,
          });
        });
      });
    }
    return this.context(record);
  }

  public expire(id: string, now = new Date()): boolean {
    const record = this.records.get(id);
    if (record === undefined || record.status !== 'PENDING') return false;
    if (now.getTime() < record.expiresAt.getTime()) return false;
    this.markTerminal(record, 'EXPIRED');
    if (record.onExpire !== undefined) {
      void record.onExpire().catch((error: unknown) => {
        this.logger.warn('confirmation expiry response could not be updated', {
          confirmationId: id,
          error,
        });
      });
    }
    return true;
  }

  public clear(): void {
    for (const record of this.records.values()) {
      clearTimeout(record.timer);
      if (record.cleanupTimer !== undefined) clearTimeout(record.cleanupTimer);
    }
    this.records.clear();
  }

  private markTerminal(record: ConfirmationRecord, status: ConfirmationTerminalState): void {
    record.status = status;
    clearTimeout(record.timer);
    const cleanupTimer = setTimeout(() => {
      if (this.records.get(record.id) === record) this.records.delete(record.id);
    }, this.lifetimeMs);
    cleanupTimer.unref();
    record.cleanupTimer = cleanupTimer;
  }

  private resolve(
    customId: string,
    discordUserId: string,
    now: Date,
    expectedActions: ReadonlyArray<'confirm' | 'staff-only' | 'cancel'>,
  ): ConfirmationRecord {
    const match = confirmationCustomIdPattern.exec(customId);
    if (
      match === null ||
      match[1] === undefined ||
      match[2] === undefined ||
      !expectedActions.includes(match[2] as 'confirm' | 'staff-only' | 'cancel')
    ) {
      throw new InvalidConfirmationTokenError();
    }
    const record = this.records.get(match[1]);
    if (record === undefined) throw new StaleConfirmationError();
    if (record.initiatorDiscordUserId !== discordUserId) {
      throw new ConfirmationOwnershipError();
    }
    if (record.status !== 'PENDING') throw new ConfirmationAlreadyHandledError();
    if (now.getTime() >= record.expiresAt.getTime()) {
      this.expire(record.id, now);
      throw new StaleConfirmationError();
    }
    return record;
  }

  private context(record: ConfirmationRecord): ConfirmationContext {
    return {
      action: record.action,
      commandName: record.commandName,
      discordGuildId: record.discordGuildId,
      initiatorDiscordUserId: record.initiatorDiscordUserId,
      teamId: record.teamId,
      ...(record.team2Id === undefined ? {} : { team2Id: record.team2Id }),
      ...(record.targetDiscordUserId === undefined
        ? {}
        : { targetDiscordUserId: record.targetDiscordUserId }),
      ...(record.initiatorStaffRole === undefined
        ? {}
        : { initiatorStaffRole: record.initiatorStaffRole }),
      ...(record.targetStaffRole === undefined ? {} : { targetStaffRole: record.targetStaffRole }),
      ...(record.destinationStaffRole === undefined
        ? {}
        : { destinationStaffRole: record.destinationStaffRole }),
    };
  }
}
