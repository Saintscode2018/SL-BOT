import { describe, expect, it, vi } from 'vitest';

import {
  DiscordRoleCompensationFailedError,
  DiscordRoleUpdateFailedError,
} from '../../src/domain/errors.js';
import type { MemberRoleMutationPlan } from '../../src/domain/roster-mutation.js';
import type { AppliedMemberRoleMutation } from '../../src/services/member-role-synchronization-service.js';
import { RoleSynchronizedMutationService } from '../../src/services/role-synchronized-mutation-service.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

function plan(user: string): MemberRoleMutationPlan {
  return {
    discordGuildId: '100000000000000001',
    discordUserId: user,
    addRoles: [],
    removeRoles: [{ id: `role-${user}`, purpose: 'TEAM' }],
  };
}

function fixture() {
  const applied: AppliedMemberRoleMutation = {
    addedRoles: [],
    removedRoles: [{ id: 'role', purpose: 'TEAM' }],
  };
  const apply = vi.fn<(plan: MemberRoleMutationPlan) => Promise<AppliedMemberRoleMutation>>(() =>
    Promise.resolve(applied),
  );
  const compensate = vi.fn<
    (plan: MemberRoleMutationPlan, mutation: AppliedMemberRoleMutation) => Promise<void>
  >(() => Promise.resolve());
  const logger = new MemoryLogger();
  const service = new RoleSynchronizedMutationService(
    { apply, compensate },
    { publish: () => Promise.resolve(true) },
    { publish: () => Promise.resolve(true) },
    logger,
  );
  return { service, apply, compensate, logger };
}

describe('RoleSynchronizedMutationService executeMany', () => {
  it('does not run the database mutation when the first member role removal fails', async () => {
    const { service, apply, compensate } = fixture();
    const mutate = vi.fn(() => Promise.resolve('done'));
    apply.mockRejectedValueOnce(new DiscordRoleUpdateFailedError());

    await expect(service.executeMany([plan('first')], mutate)).rejects.toBeInstanceOf(
      DiscordRoleUpdateFailedError,
    );
    expect(mutate).not.toHaveBeenCalled();
    expect(compensate).not.toHaveBeenCalled();
  });

  it('compensates earlier members when a later member role removal fails', async () => {
    const { service, apply, compensate } = fixture();
    const plans = [plan('first'), plan('second')];
    const mutate = vi.fn(() => Promise.resolve('done'));
    apply
      .mockResolvedValueOnce({ addedRoles: [], removedRoles: plans[0]!.removeRoles })
      .mockRejectedValueOnce(new DiscordRoleUpdateFailedError());

    await expect(service.executeMany(plans, mutate)).rejects.toBeInstanceOf(
      DiscordRoleUpdateFailedError,
    );
    expect(mutate).not.toHaveBeenCalled();
    expect(compensate).toHaveBeenCalledOnce();
    expect(compensate).toHaveBeenCalledWith(
      plans[0],
      expect.objectContaining({ removedRoles: plans[0]!.removeRoles }),
    );
  });

  it('compensates multiple prior successes in reverse order when a later role application fails', async () => {
    const { service, apply, compensate } = fixture();
    const plans = [plan('first'), plan('second'), plan('third')];
    const mutate = vi.fn(() => Promise.resolve('done'));
    apply
      .mockImplementationOnce((currentPlan) =>
        Promise.resolve({ addedRoles: [], removedRoles: currentPlan.removeRoles }),
      )
      .mockImplementationOnce((currentPlan) =>
        Promise.resolve({ addedRoles: [], removedRoles: currentPlan.removeRoles }),
      )
      .mockRejectedValueOnce(new DiscordRoleUpdateFailedError());

    await expect(service.executeMany(plans, mutate)).rejects.toBeInstanceOf(
      DiscordRoleUpdateFailedError,
    );
    expect(mutate).not.toHaveBeenCalled();
    expect(compensate).toHaveBeenCalledTimes(2);
    expect(compensate.mock.calls[0]?.[0]).toEqual(plans[1]);
    expect(compensate.mock.calls[1]?.[0]).toEqual(plans[0]);
  });

  it('compensates every applied member in reverse order when the database transaction fails', async () => {
    const { service, apply, compensate } = fixture();
    const plans = [plan('first'), plan('second')];
    apply.mockImplementation((currentPlan) =>
      Promise.resolve({ addedRoles: [], removedRoles: currentPlan.removeRoles }),
    );
    const databaseError = new Error('database failed');

    await expect(service.executeMany(plans, () => Promise.reject(databaseError))).rejects.toBe(
      databaseError,
    );
    expect(compensate).toHaveBeenCalledTimes(2);
    expect(compensate.mock.calls[0]?.[0]).toEqual(plans[1]);
    expect(compensate.mock.calls[1]?.[0]).toEqual(plans[0]);
  });

  it('logs and surfaces compensation failures without reporting success', async () => {
    const { service, compensate, logger } = fixture();
    compensate.mockRejectedValueOnce(new DiscordRoleCompensationFailedError(['TEAM']));

    const error = await service
      .executeMany([plan('first')], () => Promise.reject(new Error('database failed')))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DiscordRoleCompensationFailedError);
    expect(logger.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'error',
          message: 'database mutation failed and Discord compensation also failed',
        }),
      ]),
    );
  });

  it('continues compensating remaining plans after one reverse-order compensation fails', async () => {
    const { service, apply, compensate, logger } = fixture();
    const plans = [plan('first'), plan('second')];
    apply.mockImplementation((currentPlan) =>
      Promise.resolve({ addedRoles: [], removedRoles: currentPlan.removeRoles }),
    );
    compensate
      .mockRejectedValueOnce(new DiscordRoleCompensationFailedError(['TEAM']))
      .mockResolvedValueOnce();

    const error = await service
      .executeMany(plans, () => Promise.reject(new Error('database failed')))
      .catch((caught: unknown) => caught);

    expect(compensate).toHaveBeenCalledTimes(2);
    expect(compensate.mock.calls[0]?.[0]).toEqual(plans[1]);
    expect(compensate.mock.calls[1]?.[0]).toEqual(plans[0]);
    expect(error).toBeInstanceOf(DiscordRoleCompensationFailedError);
    expect(logger.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'error',
          message: 'database mutation failed and Discord compensation also failed',
        }),
      ]),
    );
  });
});
