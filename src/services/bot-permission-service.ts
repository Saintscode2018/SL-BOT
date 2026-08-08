import type { BotPermission, Guild, Prisma, PrismaClient } from '@prisma/client';

import { botPermissionLevelSchema, type BotPermissionLevel } from '../domain/enums.js';
import {
  BotPermissionAdminAlreadyGrantedError,
  BotPermissionAdminProtectedError,
  BotPermissionAlreadyGrantedError,
  BotPermissionNotFoundError,
  GuildNotConfiguredError,
  LastBotPermissionRemovalError,
} from '../domain/errors.js';
import { AuditEventRepository } from '../repositories/audit-event-repository.js';
import {
  BotPermissionRepository,
  type BotPermissionWithUser,
} from '../repositories/bot-permission-repository.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import type { AuthorizationInput } from './authorization-service.js';
import { AuthorizationService } from './authorization-service.js';

export const botPermissionAddedAuditEventType = 'bot_permission.added';
export const botPermissionRemovedAuditEventType = 'bot_permission.removed';
export const botPermissionAdminAddedAuditEventType = 'bot_permission_admin.added';
export const botPermissionPromotedAuditEventType = 'bot_permission.promoted';

export interface BotPermissionMutationInput {
  authorization: AuthorizationInput;
  targetDiscordUserId: string;
}

export interface BotPermissionMutationResult {
  guild: Guild;
  permission: BotPermission;
  auditChannelId: string | null;
  beforeLevel: BotPermissionLevel | null;
  afterLevel: BotPermissionLevel | null;
  targetDiscordUserId: string;
  mutation: 'added' | 'promoted' | 'removed';
}

export interface BotPermissionListResult {
  guild: Guild;
  permissions: BotPermissionWithUser[];
}

function permissionLevel(permission: BotPermission): BotPermissionLevel {
  return botPermissionLevelSchema.parse(permission.level);
}

export class BotPermissionService {
  public constructor(private readonly database: PrismaClient) {}

  public async addStandard(
    input: BotPermissionMutationInput,
  ): Promise<BotPermissionMutationResult> {
    return this.database.$transaction(async (transaction) => {
      const guilds = new GuildRepository(transaction);
      await guilds.acquireWriteLock(input.authorization.discordGuildId);
      await new AuthorizationService(transaction).assertCanManageBotPermissions(
        input.authorization,
        { allowFirstDiscordAdministratorGrant: true },
      );
      const guild = await guilds.getByDiscordGuildId(input.authorization.discordGuildId);
      if (guild === null) {
        throw new GuildNotConfiguredError('run /setup league before granting Bot Permissions');
      }
      const users = new UserRepository(transaction);
      const actor = await users.getOrCreateByDiscordUserId(input.authorization.discordUserId);
      const target = await users.getOrCreateByDiscordUserId(input.targetDiscordUserId);
      const permissions = new BotPermissionRepository(transaction);
      const existing = await permissions.getForGuildUser(guild.id, target.id);
      if (existing !== null) {
        if (permissionLevel(existing) === 'BOTPERM_ADMIN') {
          throw new BotPermissionAdminAlreadyGrantedError();
        }
        throw new BotPermissionAlreadyGrantedError();
      }

      const permission = await permissions.create({
        guildId: guild.id,
        userId: target.id,
        level: 'BOTPERM',
        grantedByUserId: actor.id,
      });
      await this.createAuditEvent(transaction, {
        guildId: guild.id,
        discordGuildId: guild.discordGuildId,
        actorUserId: actor.id,
        actorDiscordUserId: input.authorization.discordUserId,
        targetDiscordUserId: input.targetDiscordUserId,
        permissionId: permission.id,
        eventType: botPermissionAddedAuditEventType,
        beforeLevel: null,
        afterLevel: 'BOTPERM',
      });
      const settings = await guilds.getSettings(guild.id);
      return {
        guild,
        permission,
        auditChannelId: settings?.auditChannelId ?? null,
        beforeLevel: null,
        afterLevel: 'BOTPERM',
        targetDiscordUserId: input.targetDiscordUserId,
        mutation: 'added',
      };
    });
  }

  public async removeStandard(
    input: BotPermissionMutationInput,
  ): Promise<BotPermissionMutationResult> {
    return this.database.$transaction(async (transaction) => {
      const guilds = new GuildRepository(transaction);
      await guilds.acquireWriteLock(input.authorization.discordGuildId);
      await new AuthorizationService(transaction).assertCanManageBotPermissions(
        input.authorization,
      );
      const guild = await guilds.getByDiscordGuildId(input.authorization.discordGuildId);
      if (guild === null) throw new GuildNotConfiguredError('this server has not been configured');
      const users = new UserRepository(transaction);
      const actor = await users.getOrCreateByDiscordUserId(input.authorization.discordUserId);
      const target = await users.getByDiscordUserId(input.targetDiscordUserId);
      if (target === null) throw new BotPermissionNotFoundError();
      const permissions = new BotPermissionRepository(transaction);
      const existing = await permissions.getForGuildUser(guild.id, target.id);
      if (existing === null) throw new BotPermissionNotFoundError();
      if (permissionLevel(existing) === 'BOTPERM_ADMIN') {
        throw new BotPermissionAdminProtectedError();
      }

      const permissionCount = await permissions.countForGuild(guild.id);
      if (permissionCount <= 1) throw new LastBotPermissionRemovalError();
      const deleted = await permissions.deleteStandardIfAnotherPermissionExists(
        existing.id,
        guild.id,
      );
      if (!deleted) throw new LastBotPermissionRemovalError();

      await this.createAuditEvent(transaction, {
        guildId: guild.id,
        discordGuildId: guild.discordGuildId,
        actorUserId: actor.id,
        actorDiscordUserId: input.authorization.discordUserId,
        targetDiscordUserId: input.targetDiscordUserId,
        permissionId: existing.id,
        eventType: botPermissionRemovedAuditEventType,
        beforeLevel: 'BOTPERM',
        afterLevel: null,
      });
      const settings = await guilds.getSettings(guild.id);
      return {
        guild,
        permission: existing,
        auditChannelId: settings?.auditChannelId ?? null,
        beforeLevel: 'BOTPERM',
        afterLevel: null,
        targetDiscordUserId: input.targetDiscordUserId,
        mutation: 'removed',
      };
    });
  }

  public async addAdmin(input: BotPermissionMutationInput): Promise<BotPermissionMutationResult> {
    return this.database.$transaction(async (transaction) => {
      const guilds = new GuildRepository(transaction);
      await guilds.acquireWriteLock(input.authorization.discordGuildId);
      await new AuthorizationService(transaction).assertCanManageBotPermissions(
        input.authorization,
      );
      const guild = await guilds.getByDiscordGuildId(input.authorization.discordGuildId);
      if (guild === null) throw new GuildNotConfiguredError('this server has not been configured');
      const users = new UserRepository(transaction);
      const actor = await users.getOrCreateByDiscordUserId(input.authorization.discordUserId);
      const target = await users.getOrCreateByDiscordUserId(input.targetDiscordUserId);
      const permissions = new BotPermissionRepository(transaction);
      const existing = await permissions.getForGuildUser(guild.id, target.id);
      if (existing !== null && permissionLevel(existing) === 'BOTPERM_ADMIN') {
        throw new BotPermissionAdminAlreadyGrantedError();
      }

      const permission =
        existing === null
          ? await permissions.create({
              guildId: guild.id,
              userId: target.id,
              level: 'BOTPERM_ADMIN',
              grantedByUserId: actor.id,
            })
          : await permissions.updateLevel(existing.id, 'BOTPERM_ADMIN', actor.id);
      const beforeLevel: BotPermissionLevel | null = existing === null ? null : 'BOTPERM';
      const mutation = existing === null ? 'added' : 'promoted';
      await this.createAuditEvent(transaction, {
        guildId: guild.id,
        discordGuildId: guild.discordGuildId,
        actorUserId: actor.id,
        actorDiscordUserId: input.authorization.discordUserId,
        targetDiscordUserId: input.targetDiscordUserId,
        permissionId: permission.id,
        eventType:
          existing === null
            ? botPermissionAdminAddedAuditEventType
            : botPermissionPromotedAuditEventType,
        beforeLevel,
        afterLevel: 'BOTPERM_ADMIN',
      });
      const settings = await guilds.getSettings(guild.id);
      return {
        guild,
        permission,
        auditChannelId: settings?.auditChannelId ?? null,
        beforeLevel,
        afterLevel: 'BOTPERM_ADMIN',
        targetDiscordUserId: input.targetDiscordUserId,
        mutation,
      };
    });
  }

  public async list(input: AuthorizationInput): Promise<BotPermissionListResult> {
    await new AuthorizationService(this.database).assertCanManageBotPermissions(input);
    const guild = await new GuildRepository(this.database).getByDiscordGuildId(
      input.discordGuildId,
    );
    if (guild === null) throw new GuildNotConfiguredError('this server has not been configured');
    const permissions = await new BotPermissionRepository(this.database).listForGuild(guild.id);
    return { guild, permissions };
  }

  private async createAuditEvent(
    transaction: Prisma.TransactionClient,
    input: {
      guildId: string;
      discordGuildId: string;
      actorUserId: string;
      actorDiscordUserId: string;
      targetDiscordUserId: string;
      permissionId: string;
      eventType: string;
      beforeLevel: BotPermissionLevel | null;
      afterLevel: BotPermissionLevel | null;
    },
  ): Promise<void> {
    await new AuditEventRepository(transaction).create({
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      eventType: input.eventType,
      entityType: 'bot_permission',
      entityId: input.permissionId,
      beforeState: { permissionLevel: input.beforeLevel },
      afterState: { permissionLevel: input.afterLevel },
      metadata: {
        discordGuildId: input.discordGuildId,
        actorDiscordUserId: input.actorDiscordUserId,
        targetDiscordUserId: input.targetDiscordUserId,
      },
    });
  }
}
