import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AdministrativeWrongChannelError,
  BotUserNotAllowedError,
  ModerationAuthorizationError,
  ModerationBotPermissionError,
  ModerationCaseAlreadyActiveError,
  ModerationChannelNotConfiguredError,
  ModerationCompensationFailedError,
  ModerationExistingTimeoutLongerError,
  ModerationMemberFetchError,
  ModerationMemberNotFoundError,
  ModerationSelfTargetError,
  ModerationTargetNotModeratableError,
  ModerationTimeoutApplyError,
  ModerationTimeoutRemoveError,
  ModerationTimeoutTooLongError,
} from '../../src/domain/errors.js';
import { maximumDiscordTimeoutSeconds } from '../../src/domain/moderation-duration.js';
import { ModerationCaseRepository } from '../../src/repositories/moderation-case-repository.js';
import type { AuthorizationInput } from '../../src/services/authorization-service.js';
import type {
  ModerationAnnouncementPlan,
  ModerationAnnouncementPublisher,
} from '../../src/services/moderation-announcement-service.js';
import { ModerationCaseService } from '../../src/services/moderation-case-service.js';
import type {
  ModerationMemberSnapshot,
  ModerationTimeoutGateway,
} from '../../src/services/moderation-mute-service.js';
import { ModerationMuteService } from '../../src/services/moderation-mute-service.js';
import {
  ModerationRoleService,
  type ModerationRoleInspector,
} from '../../src/services/moderation-role-service.js';
import { GuildSetupService } from '../../src/services/guild-setup-service.js';
import { CommandChannelPolicyService } from '../../src/services/command-channel-policy-service.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
  grantBotPermission,
  type TestDatabase,
} from '../helpers/database.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

const discordGuildId = '991000000000000001';
const bootstrapId = '991000000000000002';
const moderatorId = '991000000000000003';
const secondModeratorId = '991000000000000004';
const targetId = '991000000000000005';
const moderationRoleId = '991000000000000006';
const staffChannelId = '991000000000000010';
const auditChannelId = '991000000000000011';
const caseFilesChannelId = '991000000000000012';
const issuedAt = new Date('2026-08-09T12:00:00.000Z');
const unmanagedRoleInspector: ModerationRoleInspector = {
  inspectGuildRole: () => Promise.resolve({ managed: false }),
};

function authorization(
  discordUserId = moderatorId,
  memberRoleIds: readonly string[] = [moderationRoleId],
): AuthorizationInput {
  return {
    discordGuildId,
    discordUserId,
    guildOwnerId: bootstrapId,
    memberRoleIds,
    hasAdministratorPermission: false,
  };
}

class FakeTimeoutGateway implements ModerationTimeoutGateway {
  public snapshot: ModerationMemberSnapshot = {
    targetIsBot: false,
    targetIsSelf: false,
    targetModeratable: true,
    botHasModerateMembers: true,
    timeoutUntil: null,
  };
  public inspectError: Error | null = null;
  public applyError: Error | null = null;
  public removeError: Error | null = null;
  public restoreError: Error | null = null;

  public readonly inspect = vi.fn(() => {
    if (this.inspectError !== null) return Promise.reject(this.inspectError);
    return Promise.resolve(this.snapshot);
  });

  public readonly applyTimeout = vi.fn((_guild: string, _user: string, expiry: Date) => {
    if (this.applyError !== null) return Promise.reject(this.applyError);
    this.snapshot = { ...this.snapshot, timeoutUntil: expiry };
    return Promise.resolve();
  });

  public readonly removeTimeout = vi.fn(() => {
    if (this.removeError !== null) return Promise.reject(this.removeError);
    this.snapshot = { ...this.snapshot, timeoutUntil: null };
    return Promise.resolve();
  });

  public readonly restoreTimeout = vi.fn(
    (_guild: string, _user: string, timeoutUntil: Date | null) => {
      if (this.restoreError !== null) return Promise.reject(this.restoreError);
      this.snapshot = { ...this.snapshot, timeoutUntil };
      return Promise.resolve();
    },
  );
}

class FakeAnnouncements implements ModerationAnnouncementPublisher {
  public result = { caseFilesDelivered: true, auditDelivered: true };
  public readonly plans: ModerationAnnouncementPlan[] = [];

  public publish(plan: ModerationAnnouncementPlan) {
    this.plans.push(plan);
    return Promise.resolve(this.result);
  }
}

describe('moderation mute execution service', () => {
  let database: TestDatabase;
  let timeouts: FakeTimeoutGateway;
  let announcements: FakeAnnouncements;
  let logger: MemoryLogger;
  let service: ModerationMuteService;
  let cases: ModerationCaseService;

  beforeAll(() => {
    database = createTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase(database.client);
    const setup = new GuildSetupService(database.client);
    const bootstrapAuthorization: AuthorizationInput = {
      ...authorization(bootstrapId, []),
      hasAdministratorPermission: true,
    };
    await setup.setupGuildOnly({
      authorization: bootstrapAuthorization,
      guildName: 'Moderation Mute League',
    });
    await setup.setupChannels({
      authorization: bootstrapAuthorization,
      guildName: 'Moderation Mute League',
      botCommandsChannelId: '991000000000000009',
      staffChannelId,
      transferChannelId: '991000000000000013',
      auditChannelId,
      caseFilesChannelId,
    });
    await grantBotPermission(database.client, discordGuildId, bootstrapId);
    await new ModerationRoleService(database.client, unmanagedRoleInspector).add({
      authorization: authorization(bootstrapId, []),
      discordRoleId: moderationRoleId,
    });
    timeouts = new FakeTimeoutGateway();
    announcements = new FakeAnnouncements();
    logger = new MemoryLogger();
    service = new ModerationMuteService(database.client, timeouts, announcements, logger);
    cases = new ModerationCaseService(database.client);
  });

  afterAll(async () => {
    await destroyTestDatabase(database);
  });

  it.each([
    ['configured moderation role', () => authorization()],
    [
      'BOTPERM',
      async () => {
        await grantBotPermission(database.client, discordGuildId, moderatorId, 'BOTPERM');
        return authorization(moderatorId, []);
      },
    ],
    [
      'BOTPERM_ADMIN',
      async () => {
        await grantBotPermission(database.client, discordGuildId, moderatorId, 'BOTPERM_ADMIN');
        return authorization(moderatorId, []);
      },
    ],
  ])('allows %s authorization to mute', async (_label, inputFactory) => {
    const inputAuthorization = await inputFactory();
    await expect(
      service.mute({
        authorization: inputAuthorization,
        targetDiscordUserId: targetId,
        durationSeconds: 600,
        bail: 25,
        issuedAt,
      }),
    ).resolves.toMatchObject({ moderationCase: { type: 'MUTE', status: 'ACTIVE' } });
  });

  it('restricts moderation-authorized callers to the configured Staff Commands channel', async () => {
    const policy = new CommandChannelPolicyService(database.client);
    await expect(
      policy.validateChannelPolicy({
        authorization: authorization(),
        channelId: staffChannelId,
        commandName: 'mute',
      }),
    ).resolves.toBeUndefined();
    await expect(
      policy.validateChannelPolicy({
        authorization: authorization(),
        channelId: '991000000000000098',
        commandName: 'unmute',
      }),
    ).rejects.toBeInstanceOf(AdministrativeWrongChannelError);
  });

  it.each([
    ['outsider', authorization(moderatorId, [])],
    ['ordinary team staff role', authorization(moderatorId, ['991000000000000099'])],
  ])('denies a %s without mutating Discord or cases', async (_label, denied) => {
    await expect(
      service.mute({
        authorization: denied,
        targetDiscordUserId: targetId,
        durationSeconds: 600,
        bail: 0,
        issuedAt,
      }),
    ).rejects.toBeInstanceOf(ModerationAuthorizationError);
    expect(timeouts.inspect).not.toHaveBeenCalled();
    await expect(database.client.moderationCase.count()).resolves.toBe(0);
  });

  it('applies the exact timeout, creates the case with the actual actor, and publishes both destinations', async () => {
    const result = await service.mute({
      authorization: authorization(),
      targetDiscordUserId: targetId,
      reason: null,
      durationSeconds: 9_000,
      bail: 75,
      issuedAt,
    });
    const expectedExpiry = new Date('2026-08-09T14:30:00.000Z');
    expect(timeouts.applyTimeout).toHaveBeenCalledWith(
      discordGuildId,
      targetId,
      expectedExpiry,
      expect.stringContaining(moderatorId),
    );
    expect(result).toMatchObject({
      caseFilesDelivered: true,
      auditDelivered: true,
      moderationCase: {
        type: 'MUTE',
        reason: null,
        bail: 75,
        durationSeconds: 9_000,
        expiresAt: expectedExpiry,
        issuedBy: { discordUserId: moderatorId },
      },
    });
    expect(announcements.plans).toEqual([
      expect.objectContaining({
        operation: 'MUTE',
        caseFilesChannelId,
        auditChannelId,
        actorDiscordUserId: moderatorId,
        targetDiscordUserId: targetId,
        reason: null,
        durationSeconds: 9_000,
        bail: 75,
      }),
    ]);
  });

  it.each([
    ['one millisecond before', -1],
    ['at the exact boundary of', 0],
  ])(
    'treats a Discord timeout expiring %s the operation clock as inactive',
    async (_label, expiryOffsetMilliseconds) => {
      timeouts.snapshot = {
        ...timeouts.snapshot,
        timeoutUntil: new Date(issuedAt.getTime() + expiryOffsetMilliseconds),
      };

      const result = await service.mute({
        authorization: authorization(),
        targetDiscordUserId: targetId,
        durationSeconds: 600,
        bail: 0,
        issuedAt,
      });

      expect(timeouts.applyTimeout).toHaveBeenCalledWith(
        discordGuildId,
        targetId,
        result.moderationCase.expiresAt,
        expect.any(String),
      );
      expect(result.moderationCase.expiresAt).toEqual(new Date(issuedAt.getTime() + 600_000));
    },
  );

  it('extends a shorter active Discord timeout to the requested expiry', async () => {
    timeouts.snapshot = {
      ...timeouts.snapshot,
      timeoutUntil: new Date(issuedAt.getTime() + 300_000),
    };
    const requestedUntil = new Date(issuedAt.getTime() + 600_000);

    const result = await service.mute({
      authorization: authorization(),
      targetDiscordUserId: targetId,
      durationSeconds: 600,
      bail: 0,
      issuedAt,
    });

    expect(timeouts.applyTimeout).toHaveBeenCalledWith(
      discordGuildId,
      targetId,
      requestedUntil,
      expect.any(String),
    );
    expect(timeouts.snapshot.timeoutUntil).toEqual(requestedUntil);
    expect(result.moderationCase.expiresAt).toEqual(requestedUntil);
  });

  it('harmlessly reapplies an active Discord timeout at the exact requested expiry', async () => {
    const requestedUntil = new Date(issuedAt.getTime() + 600_000);
    timeouts.snapshot = { ...timeouts.snapshot, timeoutUntil: requestedUntil };

    const result = await service.mute({
      authorization: authorization(),
      targetDiscordUserId: targetId,
      durationSeconds: 600,
      bail: 0,
      issuedAt,
    });

    expect(timeouts.applyTimeout).toHaveBeenCalledWith(
      discordGuildId,
      targetId,
      requestedUntil,
      expect.any(String),
    );
    expect(result.moderationCase.expiresAt).toEqual(requestedUntil);
    expect(announcements.plans).toHaveLength(1);
  });

  it.each([
    ['one millisecond', 600_001],
    ['seven days', 7 * 24 * 60 * 60 * 1000],
  ])(
    'rejects when the active Discord timeout is longer by %s without mutating state',
    async (_label, existingOffsetMilliseconds) => {
      const existingUntil = new Date(issuedAt.getTime() + existingOffsetMilliseconds);
      timeouts.snapshot = { ...timeouts.snapshot, timeoutUntil: existingUntil };

      const error = await service
        .mute({
          authorization: authorization(),
          targetDiscordUserId: targetId,
          durationSeconds: 600,
          bail: 0,
          issuedAt,
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ModerationExistingTimeoutLongerError);
      expect(error).toMatchObject({
        code: 'MODERATION_EXISTING_TIMEOUT_LONGER',
        message: 'That user already has a longer active Discord timeout.',
      });
      expect(timeouts.applyTimeout).not.toHaveBeenCalled();
      expect(timeouts.snapshot.timeoutUntil).toEqual(existingUntil);
      await expect(database.client.moderationCase.count()).resolves.toBe(0);
      expect(announcements.plans).toHaveLength(0);
    },
  );

  it('preserves Discord inspection failures as infrastructure errors', async () => {
    const inspectionError = new ModerationMemberFetchError({
      cause: new Error('Discord inspection failed'),
    });
    timeouts.inspectError = inspectionError;

    await expect(
      service.mute({
        authorization: authorization(),
        targetDiscordUserId: targetId,
        durationSeconds: 600,
        bail: 0,
        issuedAt,
      }),
    ).rejects.toBe(inspectionError);
    expect(timeouts.applyTimeout).not.toHaveBeenCalled();
    await expect(database.client.moderationCase.count()).resolves.toBe(0);
    expect(announcements.plans).toHaveLength(0);
  });

  it('removes the timeout and manually resolves the original case without changing issue fields', async () => {
    const original = await cases.createCase({
      authorization: authorization(),
      targetDiscordUserId: targetId,
      type: 'MUTE',
      reason: 'Original reason',
      bail: 90,
      durationSeconds: 7_200,
      issuedAt,
    });
    timeouts.snapshot = { ...timeouts.snapshot, timeoutUntil: original.expiresAt };
    const resolvedAt = new Date('2026-08-09T12:30:00.000Z');
    const result = await service.unmute({
      authorization: authorization(secondModeratorId),
      targetDiscordUserId: targetId,
      reason: null,
      resolvedAt,
    });
    expect(timeouts.removeTimeout).toHaveBeenCalledOnce();
    expect(result.moderationCase).toMatchObject({
      id: original.id,
      issuedByUserId: original.issuedByUserId,
      reason: 'Original reason',
      bail: 90,
      status: 'RESOLVED',
      resolutionType: 'MANUAL',
      resolutionReason: null,
      resolvedAt,
      resolvedBy: { discordUserId: secondModeratorId },
    });
    expect(announcements.plans).toEqual([
      expect.objectContaining({
        operation: 'UNMUTE',
        actorDiscordUserId: secondModeratorId,
        reason: null,
        durationSeconds: null,
        bail: null,
      }),
    ]);
  });

  it.each(['mute', 'unmute'] as const)(
    'blocks /%s before Discord or case mutation when Case Files is missing',
    async (operation) => {
      if (operation === 'unmute') {
        await cases.createCase({
          authorization: authorization(),
          targetDiscordUserId: targetId,
          type: 'MUTE',
          bail: 0,
          durationSeconds: 600,
          issuedAt,
        });
      }
      const guild = await database.client.guild.findUniqueOrThrow({ where: { discordGuildId } });
      await database.client.guildSettings.update({
        where: { guildId: guild.id },
        data: { caseFilesChannelId: null },
      });
      const action =
        operation === 'mute'
          ? service.mute({
              authorization: authorization(),
              targetDiscordUserId: targetId,
              durationSeconds: 600,
              bail: 0,
              issuedAt,
            })
          : service.unmute({
              authorization: authorization(),
              targetDiscordUserId: targetId,
              resolvedAt: new Date(issuedAt.getTime() + 1_000),
            });
      await expect(action).rejects.toBeInstanceOf(ModerationChannelNotConfiguredError);
      expect(timeouts.inspect).not.toHaveBeenCalled();
      expect(timeouts.applyTimeout).not.toHaveBeenCalled();
      expect(timeouts.removeTimeout).not.toHaveBeenCalled();
    },
  );

  it('blocks moderation before mutation when Audit is missing', async () => {
    const guild = await database.client.guild.findUniqueOrThrow({ where: { discordGuildId } });
    await database.client.guildSettings.update({
      where: { guildId: guild.id },
      data: { auditChannelId: null },
    });
    await expect(
      service.mute({
        authorization: authorization(),
        targetDiscordUserId: targetId,
        durationSeconds: 600,
        bail: 0,
        issuedAt,
      }),
    ).rejects.toMatchObject({ channel: 'AUDIT' });
    expect(timeouts.inspect).not.toHaveBeenCalled();
    await expect(database.client.moderationCase.count()).resolves.toBe(0);
  });

  it('rejects an active duplicate before an additional timeout mutation', async () => {
    const original = await cases.createCase({
      authorization: authorization(),
      targetDiscordUserId: targetId,
      type: 'MUTE',
      bail: 0,
      durationSeconds: 600,
      issuedAt,
    });
    const error = await service
      .mute({
        authorization: authorization(),
        targetDiscordUserId: targetId,
        durationSeconds: 600,
        bail: 0,
        issuedAt,
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ModerationCaseAlreadyActiveError);
    expect(error).toMatchObject({
      type: 'MUTE',
      message: 'That user already has an active mute case.',
    });
    expect(timeouts.applyTimeout).not.toHaveBeenCalled();
    expect(announcements.plans).toHaveLength(0);
    await expect(database.client.moderationCase.count()).resolves.toBe(1);
    await expect(database.client.moderationCase.findUnique({ where: { id: original.id } })).resolves.toMatchObject({
      status: 'ACTIVE',
      resolutionType: null,
      resolvedByUserId: null,
      resolvedAt: null,
    });
  });

  it('lazily expires a stale ACTIVE mute from the service clock before creating a replacement', async () => {
    const expiredAt = new Date('2026-08-09T12:00:00.000Z');
    const stale = await cases.createCase({
      authorization: authorization(),
      targetDiscordUserId: targetId,
      type: 'MUTE',
      bail: 0,
      durationSeconds: 60,
      issuedAt: new Date(expiredAt.getTime() - 60_000),
    });
    timeouts.snapshot = { ...timeouts.snapshot, timeoutUntil: null };
    const expiredResolver = vi.spyOn(ModerationCaseRepository.prototype, 'resolveExpiredMute');
    service = new ModerationMuteService(
      database.client,
      timeouts,
      announcements,
      logger,
      undefined,
      undefined,
      () => expiredAt,
    );

    try {
      const result = await service.mute({
        authorization: authorization(secondModeratorId),
        targetDiscordUserId: targetId,
        durationSeconds: 600,
        bail: 10,
      });

      expect(expiredResolver).toHaveBeenCalledWith(stale.id, expiredAt);
      expect(timeouts.inspect).toHaveBeenCalledOnce();
      expect(timeouts.applyTimeout).toHaveBeenCalledOnce();
      expect(announcements.plans).toEqual([
        expect.objectContaining({ operation: 'MUTE', caseNumber: result.moderationCase.caseNumber }),
      ]);
      await expect(database.client.moderationCase.count()).resolves.toBe(2);
      await expect(database.client.moderationCase.findUnique({ where: { id: stale.id } })).resolves.toMatchObject({
        status: 'RESOLVED',
        resolutionType: 'EXPIRED',
        resolvedByUserId: null,
        resolutionReason: null,
        resolvedAt: expiredAt,
        expiresAt: stale.expiresAt,
      });
      await expect(
        database.client.moderationCase.findUnique({ where: { id: result.moderationCase.id } }),
      ).resolves.toMatchObject({ type: 'MUTE', status: 'ACTIVE' });
    } finally {
      expiredResolver.mockRestore();
    }
  });

  it('manually resolves a stale ACTIVE mute even when Discord already reports no timeout', async () => {
    const stale = await cases.createCase({
      authorization: authorization(),
      targetDiscordUserId: targetId,
      type: 'MUTE',
      bail: 0,
      durationSeconds: 60,
      issuedAt: new Date('2026-08-09T11:59:00.000Z'),
    });
    timeouts.snapshot = { ...timeouts.snapshot, timeoutUntil: null };
    const resolvedAt = new Date('2026-08-09T12:01:00.000Z');

    const result = await service.unmute({
      authorization: authorization(secondModeratorId),
      targetDiscordUserId: targetId,
      resolvedAt,
    });

    expect(timeouts.inspect).toHaveBeenCalledOnce();
    expect(timeouts.removeTimeout).toHaveBeenCalledOnce();
    expect(result.moderationCase).toMatchObject({
      id: stale.id,
      status: 'RESOLVED',
      resolutionType: 'MANUAL',
      resolvedBy: { discordUserId: secondModeratorId },
      resolvedAt,
    });
    expect(announcements.plans).toHaveLength(1);
    expect(announcements.plans[0]).toMatchObject({ operation: 'UNMUTE' });
  });

  it('lazily expires an ACTIVE mute at the exact expiry boundary', async () => {
    const now = new Date('2026-08-09T12:00:00.000Z');
    const stale = await cases.createCase({
      authorization: authorization(),
      targetDiscordUserId: targetId,
      type: 'MUTE',
      bail: 0,
      durationSeconds: 60,
      issuedAt: new Date(now.getTime() - 60_000),
    });

    const result = await service.mute({
      authorization: authorization(),
      targetDiscordUserId: targetId,
      durationSeconds: 600,
      bail: 0,
      issuedAt: now,
    });

    await expect(database.client.moderationCase.findUnique({ where: { id: stale.id } })).resolves.toMatchObject({
      status: 'RESOLVED',
      resolutionType: 'EXPIRED',
      resolvedAt: now,
    });
    expect(result.moderationCase).toMatchObject({ type: 'MUTE', status: 'ACTIVE' });
    expect(timeouts.applyTimeout).toHaveBeenCalledOnce();
  });

  it('keeps D2 stale-case reconciliation committed before rejecting a longer Discord timeout', async () => {
    const stale = await cases.createCase({
      authorization: authorization(),
      targetDiscordUserId: targetId,
      type: 'MUTE',
      bail: 0,
      durationSeconds: 60,
      issuedAt: new Date(issuedAt.getTime() - 60_000),
    });
    const existingUntil = new Date(issuedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    timeouts.snapshot = { ...timeouts.snapshot, timeoutUntil: existingUntil };

    await expect(
      service.mute({
        authorization: authorization(secondModeratorId),
        targetDiscordUserId: targetId,
        durationSeconds: 600,
        bail: 10,
        issuedAt,
      }),
    ).rejects.toBeInstanceOf(ModerationExistingTimeoutLongerError);

    await expect(
      database.client.moderationCase.findUnique({ where: { id: stale.id } }),
    ).resolves.toMatchObject({
      status: 'RESOLVED',
      resolutionType: 'EXPIRED',
      resolvedByUserId: null,
      resolutionReason: null,
      resolvedAt: issuedAt,
    });
    await expect(database.client.moderationCase.count()).resolves.toBe(1);
    expect(timeouts.applyTimeout).not.toHaveBeenCalled();
    expect(timeouts.snapshot.timeoutUntil).toEqual(existingUntil);
    expect(announcements.plans).toHaveLength(0);
  });

  it('keeps stale-case expiration committed when replacement case creation fails', async () => {
    const expiry = new Date('2026-08-09T12:00:00.000Z');
    const stale = await cases.createCase({
      authorization: authorization(),
      targetDiscordUserId: targetId,
      type: 'MUTE',
      bail: 0,
      durationSeconds: 60,
      issuedAt: new Date(expiry.getTime() - 60_000),
    });
    const databaseError = new Error('replacement case create failed');
    const createCase = vi
      .spyOn(ModerationCaseService.prototype, 'createCase')
      .mockRejectedValueOnce(databaseError);

    try {
      await expect(
        service.mute({
          authorization: authorization(),
          targetDiscordUserId: targetId,
          durationSeconds: 600,
          bail: 0,
          issuedAt: expiry,
        }),
      ).rejects.toBe(databaseError);

      await expect(database.client.moderationCase.findUnique({ where: { id: stale.id } })).resolves.toMatchObject({
        status: 'RESOLVED',
        resolutionType: 'EXPIRED',
        resolvedByUserId: null,
        resolutionReason: null,
        resolvedAt: expiry,
      });
      await expect(database.client.moderationCase.count()).resolves.toBe(1);
      expect(timeouts.restoreTimeout).toHaveBeenCalledWith(
        discordGuildId,
        targetId,
        null,
        expect.stringContaining('compensation'),
      );
    } finally {
      createCase.mockRestore();
    }
  });

  it('serializes concurrent stale-case replacement attempts to one new ACTIVE mute', async () => {
    const now = new Date('2026-08-09T12:00:00.000Z');
    const stale = await cases.createCase({
      authorization: authorization(),
      targetDiscordUserId: targetId,
      type: 'MUTE',
      bail: 0,
      durationSeconds: 60,
      issuedAt: new Date(now.getTime() - 60_000),
    });
    const input = {
      authorization: authorization(),
      targetDiscordUserId: targetId,
      durationSeconds: 600,
      bail: 0,
      issuedAt: now,
    };

    const results = await Promise.allSettled([service.mute(input), service.mute(input)]);
    const rejected = results.find((result) => result.status === 'rejected');

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(rejected).toBeDefined();
    if (rejected?.status === 'rejected') {
      expect(rejected.reason).toBeInstanceOf(ModerationCaseAlreadyActiveError);
    }
    expect(timeouts.applyTimeout).toHaveBeenCalledOnce();
    await expect(database.client.moderationCase.findUnique({ where: { id: stale.id } })).resolves.toMatchObject({
      status: 'RESOLVED',
      resolutionType: 'EXPIRED',
    });
    await expect(
      database.client.moderationCase.count({ where: { type: 'MUTE', status: 'ACTIVE' } }),
    ).resolves.toBe(1);
  });

  it('does not create a case when Discord timeout application fails', async () => {
    timeouts.applyError = new ModerationTimeoutApplyError();
    await expect(
      service.mute({
        authorization: authorization(),
        targetDiscordUserId: targetId,
        durationSeconds: 600,
        bail: 0,
        issuedAt,
      }),
    ).rejects.toBeInstanceOf(ModerationTimeoutApplyError);
    await expect(database.client.moderationCase.count()).resolves.toBe(0);
    expect(announcements.plans).toHaveLength(0);
  });

  it('restores the prior timeout when case creation fails after Discord succeeds', async () => {
    const priorTimeout = new Date('2026-08-09T12:05:00.000Z');
    timeouts.snapshot = { ...timeouts.snapshot, timeoutUntil: priorTimeout };
    const databaseError = new Error('case create failed');
    const failingCases = {
      getActiveCase: vi.fn(() => Promise.resolve(null)),
      createCase: vi.fn(() => Promise.reject(databaseError)),
      resolveCase: vi.fn(),
      resolveExpiredMute: vi.fn(),
    };
    service = new ModerationMuteService(
      database.client,
      timeouts,
      announcements,
      logger,
      failingCases,
    );
    await expect(
      service.mute({
        authorization: authorization(),
        targetDiscordUserId: targetId,
        durationSeconds: 600,
        bail: 0,
        issuedAt,
      }),
    ).rejects.toBe(databaseError);
    expect(timeouts.restoreTimeout).toHaveBeenCalledWith(
      discordGuildId,
      targetId,
      priorTimeout,
      expect.stringContaining('compensation'),
    );
  });

  it('surfaces and logs failed mute compensation as an infrastructure failure', async () => {
    timeouts.restoreError = new Error('restore failed');
    const failingCases = {
      getActiveCase: vi.fn(() => Promise.resolve(null)),
      createCase: vi.fn(() => Promise.reject(new Error('case create failed'))),
      resolveCase: vi.fn(),
      resolveExpiredMute: vi.fn(),
    };
    service = new ModerationMuteService(
      database.client,
      timeouts,
      announcements,
      logger,
      failingCases,
    );
    await expect(
      service.mute({
        authorization: authorization(),
        targetDiscordUserId: targetId,
        durationSeconds: 600,
        bail: 0,
        issuedAt,
      }),
    ).rejects.toBeInstanceOf(ModerationCompensationFailedError);
    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]?.level).toBe('error');
    expect(logger.entries[0]?.message).toBe(
      'moderation mutation and Discord compensation both failed',
    );
    expect(logger.entries[0]?.context).toMatchObject({
      commandName: 'mute',
      guildId: discordGuildId,
      actorDiscordUserId: moderatorId,
      targetDiscordUserId: targetId,
      operation: 'MUTE_COMPENSATION',
    });
  });

  it('keeps the case active when Discord timeout removal fails', async () => {
    const active = await cases.createCase({
      authorization: authorization(),
      targetDiscordUserId: targetId,
      type: 'MUTE',
      bail: 0,
      durationSeconds: 600,
      issuedAt,
    });
    timeouts.removeError = new ModerationTimeoutRemoveError();
    await expect(
      service.unmute({
        authorization: authorization(),
        targetDiscordUserId: targetId,
        resolvedAt: new Date(issuedAt.getTime() + 1_000),
      }),
    ).rejects.toBeInstanceOf(ModerationTimeoutRemoveError);
    await expect(
      database.client.moderationCase.findUnique({ where: { id: active.id } }),
    ).resolves.toMatchObject({
      status: 'ACTIVE',
      resolutionType: null,
    });
  });

  it('restores a future case timeout when manual resolution fails', async () => {
    const active = await cases.createCase({
      authorization: authorization(),
      targetDiscordUserId: targetId,
      type: 'MUTE',
      bail: 0,
      durationSeconds: 600,
      issuedAt,
    });
    const databaseError = new Error('resolve failed');
    const failingCases = {
      getActiveCase: vi.fn(() => Promise.resolve(active)),
      createCase: vi.fn(),
      resolveCase: vi.fn(() => Promise.reject(databaseError)),
      resolveExpiredMute: vi.fn(),
    };
    service = new ModerationMuteService(
      database.client,
      timeouts,
      announcements,
      logger,
      failingCases,
      undefined,
      () => new Date('2026-08-09T12:01:00.000Z'),
    );
    await expect(
      service.unmute({
        authorization: authorization(),
        targetDiscordUserId: targetId,
        resolvedAt: new Date('2026-08-09T12:01:00.000Z'),
      }),
    ).rejects.toBe(databaseError);
    expect(timeouts.restoreTimeout).toHaveBeenCalledWith(
      discordGuildId,
      targetId,
      active.expiresAt,
      expect.stringContaining(String(active.caseNumber)),
    );
    await expect(
      database.client.moderationCase.findUnique({ where: { id: active.id } }),
    ).resolves.toMatchObject({ status: 'ACTIVE', resolutionType: null });
  });

  it('explicitly skips impossible restoration after the active case expiry elapses', async () => {
    const active = await cases.createCase({
      authorization: authorization(),
      targetDiscordUserId: targetId,
      type: 'MUTE',
      bail: 0,
      durationSeconds: 60,
      issuedAt,
    });
    const failingCases = {
      getActiveCase: vi.fn(() => Promise.resolve(active)),
      createCase: vi.fn(),
      resolveCase: vi.fn(() => Promise.reject(new Error('resolve failed'))),
      resolveExpiredMute: vi.fn(),
    };
    service = new ModerationMuteService(
      database.client,
      timeouts,
      announcements,
      logger,
      failingCases,
      undefined,
      () => new Date('2026-08-09T12:02:00.000Z'),
    );
    await expect(
      service.unmute({
        authorization: authorization(),
        targetDiscordUserId: targetId,
        resolvedAt: new Date('2026-08-09T12:02:00.000Z'),
      }),
    ).rejects.toThrow('resolve failed');
    expect(timeouts.restoreTimeout).not.toHaveBeenCalled();
    expect(logger.entries).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        message: 'unmute database mutation failed after timeout expiry; restoration skipped',
      }),
    );
  });

  it('preserves successful moderation when one or both announcement deliveries fail', async () => {
    announcements.result = { caseFilesDelivered: false, auditDelivered: true };
    const result = await service.mute({
      authorization: authorization(),
      targetDiscordUserId: targetId,
      durationSeconds: 600,
      bail: 0,
      issuedAt,
    });
    expect(result).toMatchObject({
      caseFilesDelivered: false,
      auditDelivered: true,
      moderationCase: { status: 'ACTIVE' },
    });
    expect(timeouts.snapshot.timeoutUntil).toEqual(result.moderationCase.expiresAt);
  });

  it.each([
    ['missing member', new ModerationMemberNotFoundError(), null],
    ['unmoderatable target', null, { targetModeratable: false }],
    ['missing Moderate Members permission', null, { botHasModerateMembers: false }],
    ['the bot itself', null, { targetIsSelf: true }],
  ])(
    'rejects %s before timeout and case mutation',
    async (_label, inspectError, snapshotChange) => {
      timeouts.inspectError = inspectError;
      if (snapshotChange !== null) timeouts.snapshot = { ...timeouts.snapshot, ...snapshotChange };
      const expected =
        inspectError ??
        (snapshotChange && 'targetModeratable' in snapshotChange
          ? new ModerationTargetNotModeratableError()
          : snapshotChange && 'botHasModerateMembers' in snapshotChange
            ? new ModerationBotPermissionError()
            : new ModerationSelfTargetError());
      await expect(
        service.mute({
          authorization: authorization(),
          targetDiscordUserId: targetId,
          durationSeconds: 600,
          bail: 0,
          issuedAt,
        }),
      ).rejects.toBeInstanceOf(expected.constructor);
      expect(timeouts.applyTimeout).not.toHaveBeenCalled();
      await expect(database.client.moderationCase.count()).resolves.toBe(0);
    },
  );

  it('enforces the Discord timeout maximum at the execution-service boundary', async () => {
    await expect(
      service.mute({
        authorization: authorization(),
        targetDiscordUserId: targetId,
        durationSeconds: maximumDiscordTimeoutSeconds + 1,
        bail: 0,
        issuedAt,
      }),
    ).rejects.toBeInstanceOf(ModerationTimeoutTooLongError);
    expect(timeouts.inspect).not.toHaveBeenCalled();
  });

  it('rejects bot targets before timeout and case mutation', async () => {
    timeouts.snapshot = { ...timeouts.snapshot, targetIsBot: true };
    await expect(
      service.mute({
        authorization: authorization(),
        targetDiscordUserId: targetId,
        durationSeconds: 600,
        bail: 0,
        issuedAt,
      }),
    ).rejects.toBeInstanceOf(BotUserNotAllowedError);
    expect(timeouts.applyTimeout).not.toHaveBeenCalled();
    await expect(database.client.moderationCase.count()).resolves.toBe(0);
  });
});
