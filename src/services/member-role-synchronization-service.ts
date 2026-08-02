import {
  DiscordManageRolesPermissionError,
  DiscordMemberMissingError,
  DiscordRoleCompensationFailedError,
  DiscordRoleHierarchyError,
  DiscordRoleMissingError,
  DiscordRoleNotManageableError,
  DiscordRoleUpdateFailedError,
  StaleMutationStateError,
} from '../domain/errors.js';
import type {
  DiscordRolePurpose,
  MemberRoleMutationPlan,
  PlannedDiscordRole,
} from '../domain/roster-mutation.js';
import type { Logger } from '../logging/logger.js';

export interface DiscordRoleSnapshot extends PlannedDiscordRole {
  managed: boolean;
  position: number;
}

export interface DiscordMemberRoleSnapshot {
  memberExists: boolean;
  memberManageable: boolean;
  botHasManageRoles: boolean;
  botHighestRolePosition: number;
  memberRoleIds: readonly string[];
  roles: readonly DiscordRoleSnapshot[];
}

export interface DiscordMemberRoleGateway {
  inspect(
    discordGuildId: string,
    discordUserId: string,
    roles: readonly PlannedDiscordRole[],
  ): Promise<DiscordMemberRoleSnapshot>;
  addRole(discordGuildId: string, discordUserId: string, roleId: string): Promise<void>;
  removeRole(discordGuildId: string, discordUserId: string, roleId: string): Promise<void>;
}

export interface AppliedMemberRoleMutation {
  addedRoles: PlannedDiscordRole[];
  removedRoles: PlannedDiscordRole[];
}

function uniqueRoles(roles: readonly PlannedDiscordRole[]): PlannedDiscordRole[] {
  const byId = new Map<string, PlannedDiscordRole>();
  for (const role of roles) byId.set(role.id, role);
  return [...byId.values()];
}

export class MemberRoleSynchronizationService {
  public constructor(
    private readonly gateway: DiscordMemberRoleGateway,
    private readonly logger: Logger,
  ) {}

  public async apply(plan: MemberRoleMutationPlan): Promise<AppliedMemberRoleMutation> {
    const addRoles = uniqueRoles(plan.addRoles);
    const removeRoles = uniqueRoles(plan.removeRoles);
    const removeIds = new Set(removeRoles.map(({ id }) => id));
    if (addRoles.some(({ id }) => removeIds.has(id))) throw new StaleMutationStateError();

    const affectedRoles = uniqueRoles([...removeRoles, ...addRoles]);
    const snapshot = await this.gateway.inspect(
      plan.discordGuildId,
      plan.discordUserId,
      affectedRoles,
    );
    this.validate(snapshot, affectedRoles);

    const currentRoleIds = new Set(snapshot.memberRoleIds);
    const pendingRemovals = removeRoles.filter(({ id }) => currentRoleIds.has(id));
    const pendingAdditions = addRoles.filter(({ id }) => !currentRoleIds.has(id));
    const applied: AppliedMemberRoleMutation = { addedRoles: [], removedRoles: [] };

    try {
      for (const role of pendingRemovals) {
        await this.gateway.removeRole(plan.discordGuildId, plan.discordUserId, role.id);
        applied.removedRoles.push(role);
      }
      for (const role of pendingAdditions) {
        await this.gateway.addRole(plan.discordGuildId, plan.discordUserId, role.id);
        applied.addedRoles.push(role);
      }
      return applied;
    } catch (error: unknown) {
      await this.compensate(plan, applied);
      throw new DiscordRoleUpdateFailedError({ cause: error });
    }
  }

  public async compensate(
    plan: MemberRoleMutationPlan,
    applied: AppliedMemberRoleMutation,
  ): Promise<void> {
    const failures: Array<{ role: PlannedDiscordRole; error: unknown }> = [];
    for (const role of [...applied.addedRoles].reverse()) {
      try {
        await this.gateway.removeRole(plan.discordGuildId, plan.discordUserId, role.id);
      } catch (error: unknown) {
        failures.push({ role, error });
      }
    }
    for (const role of [...applied.removedRoles].reverse()) {
      try {
        await this.gateway.addRole(plan.discordGuildId, plan.discordUserId, role.id);
      } catch (error: unknown) {
        failures.push({ role, error });
      }
    }
    if (failures.length === 0) return;

    const purposes = failures.map(({ role }) => role.purpose);
    const compensationError = new DiscordRoleCompensationFailedError(purposes, {
      cause: new AggregateError(
        failures.map(({ error }) => error),
        'Discord role compensation failed',
      ),
    });
    this.logger.error('Discord role compensation failed', compensationError, {
      discordGuildId: plan.discordGuildId,
      discordUserId: plan.discordUserId,
      affectedRolePurposes: purposes,
    });
    throw compensationError;
  }

  private validate(
    snapshot: DiscordMemberRoleSnapshot,
    affectedRoles: readonly PlannedDiscordRole[],
  ): void {
    if (!snapshot.memberExists) throw new DiscordMemberMissingError();
    if (!snapshot.botHasManageRoles) throw new DiscordManageRolesPermissionError();
    if (!snapshot.memberManageable) throw new DiscordRoleHierarchyError();

    const snapshotsById = new Map(snapshot.roles.map((role) => [role.id, role]));
    for (const plannedRole of affectedRoles) {
      const role = snapshotsById.get(plannedRole.id);
      if (role === undefined) throw new DiscordRoleMissingError(plannedRole.purpose);
      if (role.managed) throw new DiscordRoleNotManageableError();
      if (snapshot.botHighestRolePosition <= role.position) {
        throw new DiscordRoleHierarchyError();
      }
    }
  }
}

export function rolePurposeLabel(purpose: DiscordRolePurpose): string {
  return purpose === 'TEAM' ? 'team' : purpose;
}
