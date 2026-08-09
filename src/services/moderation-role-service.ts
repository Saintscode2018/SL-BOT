import type { Guild, ModerationRole, Prisma, PrismaClient } from '@prisma/client';

import {
  GuildNotConfiguredError,
  ModerationRoleAlreadyConfiguredError,
  ModerationRoleEveryoneError,
  ModerationRoleManagedError,
  ModerationRoleMissingError,
  ModerationRoleNotConfiguredError,
} from '../domain/errors.js';
import { AuditEventRepository } from '../repositories/audit-event-repository.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import { ModerationRoleRepository } from '../repositories/moderation-role-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import type { AuthorizationInput } from './authorization-service.js';
import { AuthorizationService } from './authorization-service.js';

export const moderationRoleAddedAuditEventType = 'moderation_role.added';
export const moderationRoleRemovedAuditEventType = 'moderation_role.removed';

export interface ModerationRoleMutationInput {
  authorization: AuthorizationInput;
  discordRoleId: string;
}

export interface ModerationRoleMutationResult {
  guild: Guild;
  moderationRole: ModerationRole;
  auditChannelId: string | null;
  mutation: 'added' | 'removed';
}

export interface ModerationRoleListResult {
  guild: Guild;
  moderationRoles: ModerationRole[];
}

export interface ModerationRoleInspection {
  managed: boolean;
}

export interface ModerationRoleInspector {
  inspectGuildRole(
    discordGuildId: string,
    discordRoleId: string,
  ): Promise<ModerationRoleInspection | null>;
}

export class ModerationRoleService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly roleInspector: ModerationRoleInspector,
  ) {}

  public async add(input: ModerationRoleMutationInput): Promise<ModerationRoleMutationResult> {
    await new AuthorizationService(this.database).assertCanSetup(input.authorization);
    const guild = await new GuildRepository(this.database).getByDiscordGuildId(
      input.authorization.discordGuildId,
    );
    if (guild === null) throw new GuildNotConfiguredError('this server has not been configured');
    if (input.discordRoleId === guild.discordGuildId) {
      throw new ModerationRoleEveryoneError();
    }
    const inspection = await this.roleInspector.inspectGuildRole(
      guild.discordGuildId,
      input.discordRoleId,
    );
    if (inspection === null) throw new ModerationRoleMissingError(input.discordRoleId);
    if (inspection?.managed) throw new ModerationRoleManagedError(input.discordRoleId);

    return this.database.$transaction(async (transaction) => {
      const guilds = new GuildRepository(transaction);
      await guilds.acquireWriteLock(input.authorization.discordGuildId);
      await new AuthorizationService(transaction).assertCanSetup(input.authorization);
      const guild = await guilds.getByDiscordGuildId(input.authorization.discordGuildId);
      if (guild === null) throw new GuildNotConfiguredError('this server has not been configured');
      if (input.discordRoleId === guild.discordGuildId) {
        throw new ModerationRoleEveryoneError();
      }

      const roles = new ModerationRoleRepository(transaction);
      if ((await roles.getForGuildRole(guild.id, input.discordRoleId)) !== null) {
        throw new ModerationRoleAlreadyConfiguredError(input.discordRoleId);
      }
      const actor = await new UserRepository(transaction).getOrCreateByDiscordUserId(
        input.authorization.discordUserId,
      );
      const moderationRole = await roles.create({
        guildId: guild.id,
        discordRoleId: input.discordRoleId,
        createdByUserId: actor.id,
      });
      await this.createAuditEvent(transaction, {
        guild,
        actorUserId: actor.id,
        actorDiscordUserId: input.authorization.discordUserId,
        moderationRole,
        eventType: moderationRoleAddedAuditEventType,
        configured: true,
      });
      const settings = await guilds.getSettings(guild.id);
      return {
        guild,
        moderationRole,
        auditChannelId: settings?.auditChannelId ?? null,
        mutation: 'added',
      };
    });
  }

  public async remove(input: ModerationRoleMutationInput): Promise<ModerationRoleMutationResult> {
    return this.database.$transaction(async (transaction) => {
      const guilds = new GuildRepository(transaction);
      await guilds.acquireWriteLock(input.authorization.discordGuildId);
      await new AuthorizationService(transaction).assertCanSetup(input.authorization);
      const guild = await guilds.getByDiscordGuildId(input.authorization.discordGuildId);
      if (guild === null) throw new GuildNotConfiguredError('this server has not been configured');

      const roles = new ModerationRoleRepository(transaction);
      const existing = await roles.getForGuildRole(guild.id, input.discordRoleId);
      if (existing === null) throw new ModerationRoleNotConfiguredError(input.discordRoleId);
      const actor = await new UserRepository(transaction).getOrCreateByDiscordUserId(
        input.authorization.discordUserId,
      );
      const moderationRole = await roles.delete(existing.id);
      await this.createAuditEvent(transaction, {
        guild,
        actorUserId: actor.id,
        actorDiscordUserId: input.authorization.discordUserId,
        moderationRole,
        eventType: moderationRoleRemovedAuditEventType,
        configured: false,
      });
      const settings = await guilds.getSettings(guild.id);
      return {
        guild,
        moderationRole,
        auditChannelId: settings?.auditChannelId ?? null,
        mutation: 'removed',
      };
    });
  }

  public async list(input: AuthorizationInput): Promise<ModerationRoleListResult> {
    await new AuthorizationService(this.database).assertCanSetup(input);
    const guild = await new GuildRepository(this.database).getByDiscordGuildId(
      input.discordGuildId,
    );
    if (guild === null) throw new GuildNotConfiguredError('this server has not been configured');
    const moderationRoles = await new ModerationRoleRepository(this.database).listForGuild(
      guild.id,
    );
    return { guild, moderationRoles };
  }

  private async createAuditEvent(
    transaction: Prisma.TransactionClient,
    input: {
      guild: Guild;
      actorUserId: string;
      actorDiscordUserId: string;
      moderationRole: ModerationRole;
      eventType: string;
      configured: boolean;
    },
  ): Promise<void> {
    await new AuditEventRepository(transaction).create({
      guildId: input.guild.id,
      actorUserId: input.actorUserId,
      eventType: input.eventType,
      entityType: 'moderation_role',
      entityId: input.moderationRole.id,
      beforeState: {
        discordRoleId: input.moderationRole.discordRoleId,
        configured: !input.configured,
      },
      afterState: {
        discordRoleId: input.moderationRole.discordRoleId,
        configured: input.configured,
      },
      metadata: {
        discordGuildId: input.guild.discordGuildId,
        discordRoleId: input.moderationRole.discordRoleId,
        actorDiscordUserId: input.actorDiscordUserId,
      },
    });
  }
}
