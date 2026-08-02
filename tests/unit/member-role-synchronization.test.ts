import { describe, expect, it, vi } from 'vitest';

import {
  DiscordManageRolesPermissionError,
  DiscordMemberMissingError,
  DiscordRoleCompensationFailedError,
  DiscordRoleHierarchyError,
  DiscordRoleMissingError,
  DiscordRoleNotManageableError,
  DiscordRoleUpdateFailedError,
} from '../../src/domain/errors.js';
import type { MemberRoleMutationPlan } from '../../src/domain/roster-mutation.js';
import {
  MemberRoleSynchronizationService,
  type DiscordMemberRoleGateway,
  type DiscordMemberRoleSnapshot,
} from '../../src/services/member-role-synchronization-service.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

const plan: MemberRoleMutationPlan = {
  discordGuildId: '100000000000000001',
  discordUserId: '200000000000000001',
  addRoles: [{ id: '300000000000000001', purpose: 'TEAM' }],
  removeRoles: [{ id: '300000000000000002', purpose: 'PM' }],
};

function fixture(overrides: Partial<DiscordMemberRoleSnapshot> = {}) {
  const snapshot: DiscordMemberRoleSnapshot = {
    memberExists: true,
    memberManageable: true,
    botHasManageRoles: true,
    botHighestRolePosition: 100,
    memberRoleIds: ['300000000000000002'],
    roles: [
      { ...plan.addRoles[0]!, managed: false, position: 10 },
      { ...plan.removeRoles[0]!, managed: false, position: 11 },
    ],
    ...overrides,
  };
  const inspect = vi.fn(() => Promise.resolve(snapshot));
  const addRole = vi.fn(() => Promise.resolve());
  const removeRole = vi.fn(() => Promise.resolve());
  const gateway: DiscordMemberRoleGateway = { inspect, addRole, removeRole };
  const logger = new MemoryLogger();
  return {
    gateway,
    inspect,
    addRole,
    removeRole,
    logger,
    service: new MemberRoleSynchronizationService(gateway, logger),
  };
}

describe('member role synchronization', () => {
  it('explains the complete Discord hierarchy requirement', () => {
    expect(new DiscordRoleHierarchyError().message).toBe(
      'The bot’s highest Discord role must be above the target member’s highest role and every role being added or removed.',
    );
  });

  it('removes obsolete roles before adding new roles', async () => {
    const { addRole, removeRole, service } = fixture();
    const result = await service.apply(plan);
    expect(result).toEqual({ addedRoles: plan.addRoles, removedRoles: plan.removeRoles });
    expect(removeRole).toHaveBeenCalledWith(
      plan.discordGuildId,
      plan.discordUserId,
      plan.removeRoles[0]!.id,
    );
    expect(addRole).toHaveBeenCalledWith(
      plan.discordGuildId,
      plan.discordUserId,
      plan.addRoles[0]!.id,
    );
    expect(removeRole.mock.invocationCallOrder[0]).toBeLessThan(
      addRole.mock.invocationCallOrder[0]!,
    );
  });

  it('skips role mutations when Discord is already correct', async () => {
    const { addRole, removeRole, service } = fixture({
      memberRoleIds: [plan.addRoles[0]!.id],
    });
    await expect(service.apply(plan)).resolves.toEqual({ addedRoles: [], removedRoles: [] });
    expect(addRole).not.toHaveBeenCalled();
    expect(removeRole).not.toHaveBeenCalled();
  });

  it.each([
    [{ memberExists: false }, DiscordMemberMissingError],
    [{ botHasManageRoles: false }, DiscordManageRolesPermissionError],
    [{ memberManageable: false }, DiscordRoleHierarchyError],
    [{ roles: [] }, DiscordRoleMissingError],
    [
      {
        roles: [
          { ...plan.addRoles[0]!, managed: true, position: 10 },
          { ...plan.removeRoles[0]!, managed: false, position: 11 },
        ],
      },
      DiscordRoleNotManageableError,
    ],
    [{ botHighestRolePosition: 11 }, DiscordRoleHierarchyError],
  ] as const)('rejects an infeasible snapshot %#', async (override, ErrorType) => {
    const { service } = fixture(override);
    await expect(service.apply(plan)).rejects.toBeInstanceOf(ErrorType);
  });

  it('compensates a partial API mutation before surfacing the update failure', async () => {
    const { addRole, service } = fixture();
    addRole.mockRejectedValueOnce(new Error('Discord add failed')).mockResolvedValueOnce();
    await expect(service.apply(plan)).rejects.toBeInstanceOf(DiscordRoleUpdateFailedError);
    expect(addRole).toHaveBeenLastCalledWith(
      plan.discordGuildId,
      plan.discordUserId,
      plan.removeRoles[0]!.id,
    );
  });

  it('logs and surfaces compensation failure with affected role purposes', async () => {
    const { addRole, logger, service } = fixture();
    addRole.mockRejectedValue(new Error('all adds fail'));
    const error = await service.apply(plan).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DiscordRoleCompensationFailedError);
    expect(error).toMatchObject({ affectedRolePurposes: ['PM'] });
    expect(logger.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ level: 'error' })]),
    );
  });
});
