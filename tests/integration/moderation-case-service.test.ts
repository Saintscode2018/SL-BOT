import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ModerationCaseType } from '../../src/domain/enums.js';
import {
  InvalidBailError,
  InvalidModerationDurationError,
  InvalidModerationReasonError,
  InvalidModerationTimestampError,
  ModerationAuthorizationError,
  ModerationCaseAlreadyActiveError,
  ModerationCaseNotActiveError,
} from '../../src/domain/errors.js';
import type { AuthorizationInput } from '../../src/services/authorization-service.js';
import { AuthorizationService } from '../../src/services/authorization-service.js';
import { BotPermissionService } from '../../src/services/bot-permission-service.js';
import { GuildSetupService } from '../../src/services/guild-setup-service.js';
import { ModerationCaseRepository } from '../../src/repositories/moderation-case-repository.js';
import {
  ModerationCaseService,
  type CreateModerationCaseInput,
} from '../../src/services/moderation-case-service.js';
import { ModerationRoleService } from '../../src/services/moderation-role-service.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
  type TestDatabase,
} from '../helpers/database.js';

const guildId = '970000000000000001';
const secondGuildId = '970000000000000002';
const bootstrapAdminId = '970000000000000003';
const botPermId = '970000000000000004';
const botPermAdminId = '970000000000000005';
const moderatorId = '970000000000000006';
const resolverId = '970000000000000007';
const outsiderId = '970000000000000008';
const targetId = '970000000000000009';
const moderationRoleId = '980000000000000001';
const issuedAt = new Date('2026-08-09T12:00:00.000Z');
const resolvedAt = new Date('2026-08-09T13:00:00.000Z');

function authorization(
  discordUserId: string,
  options: { guild?: string; roles?: readonly string[]; administrator?: boolean } = {},
): AuthorizationInput {
  return {
    discordGuildId: options.guild ?? guildId,
    discordUserId,
    guildOwnerId: bootstrapAdminId,
    memberRoleIds: options.roles ?? [],
    hasAdministratorPermission: options.administrator ?? false,
  };
}

function moderatorAuthorization(
  discordUserId = moderatorId,
  discordGuildId = guildId,
): AuthorizationInput {
  return authorization(discordUserId, { guild: discordGuildId, roles: [moderationRoleId] });
}

describe('moderation case service', () => {
  let database: TestDatabase;
  let cases: ModerationCaseService;
  let permissions: BotPermissionService;
  let setup: GuildSetupService;
  let roles: ModerationRoleService;

  beforeAll(() => {
    database = createTestDatabase();
  });

  beforeEach(async () => {
    await clearDatabase(database.client);
    cases = new ModerationCaseService(database.client);
    permissions = new BotPermissionService(database.client);
    setup = new GuildSetupService(database.client);
    roles = new ModerationRoleService(database.client);
    await bootstrapGuild(guildId, botPermId);
    await permissions.addAdmin({
      authorization: authorization(botPermId),
      targetDiscordUserId: botPermAdminId,
    });
    await roles.add({
      authorization: authorization(botPermId),
      discordRoleId: moderationRoleId,
    });
  });

  afterAll(async () => {
    await destroyTestDatabase(database);
  });

  async function bootstrapGuild(discordGuildId: string, firstBotPermId: string): Promise<void> {
    const administrator = authorization(bootstrapAdminId, {
      guild: discordGuildId,
      administrator: true,
    });
    await setup.setupGuildOnly({
      authorization: administrator,
      guildName: `Moderation League ${discordGuildId}`,
    });
    await setup.setupChannels({
      authorization: administrator,
      guildName: `Moderation League ${discordGuildId}`,
      botCommandsChannelId: '990000000000000001',
      staffChannelId: '990000000000000002',
      transferChannelId: '990000000000000003',
      auditChannelId: '990000000000000004',
      caseFilesChannelId: '990000000000000005',
    });
    await permissions.addStandard({
      authorization: administrator,
      targetDiscordUserId: firstBotPermId,
    });
  }

  function createInput(
    type: ModerationCaseType,
    overrides: Partial<CreateModerationCaseInput> = {},
  ): CreateModerationCaseInput {
    return {
      authorization: moderatorAuthorization(),
      targetDiscordUserId: targetId,
      type,
      reason: 'Repeated misconduct',
      bail: 250,
      ...(type === 'MUTE' ? { durationSeconds: 3600 } : {}),
      issuedAt,
      ...overrides,
    };
  }

  it.each([
    ['configured moderation role', () => moderatorAuthorization(), 'moderation_role'],
    ['BOTPERM', () => authorization(botPermId), 'BOTPERM'],
    ['BOTPERM_ADMIN', () => authorization(botPermAdminId), 'BOTPERM_ADMIN'],
  ] as const)('allows %s to create a case', async (_label, getAuthorization, expectedKind) => {
    const input = createInput('BAN', { authorization: getAuthorization() });

    const result = await cases.createCase(input);

    expect(result).toMatchObject({ caseNumber: 1, type: 'BAN', status: 'ACTIVE' });
    await expect(
      new AuthorizationService(database.client).getModerationAuthorizationKind(getAuthorization()),
    ).resolves.toBe(expectedKind);
  });

  it('rejects unauthorized creation without allocating a case number', async () => {
    await expect(
      cases.createCase(createInput('BAN', { authorization: authorization(outsiderId) })),
    ).rejects.toBeInstanceOf(ModerationAuthorizationError);
    await expect(database.client.moderationCase.count()).resolves.toBe(0);
    await expect(database.client.moderationCaseCounter.count()).resolves.toBe(0);
  });

  it('creates the target user, attributes the actual issuer, and preserves null reason and bail', async () => {
    const result = await cases.createCase(
      createInput('MUTE', {
        reason: null,
        bail: 0,
        durationSeconds: 90,
      }),
    );

    expect(result).toMatchObject({
      caseNumber: 1,
      target: { discordUserId: targetId },
      issuedBy: { discordUserId: moderatorId },
      reason: null,
      bail: 0,
      durationSeconds: 90,
      expiresAt: new Date('2026-08-09T12:01:30.000Z'),
      status: 'ACTIVE',
      resolutionType: null,
      resolvedByUserId: null,
      resolutionReason: null,
      resolvedAt: null,
    });
    await expect(
      database.client.leagueUser.findUnique({ where: { discordUserId: targetId } }),
    ).resolves.toMatchObject({ id: result.targetUserId });
  });

  it.each([-1, 1.5, 2_147_483_648])('rejects invalid bail %s', async (bail) => {
    await expect(cases.createCase(createInput('BAN', { bail }))).rejects.toBeInstanceOf(
      InvalidBailError,
    );
  });

  it('requires a duration for mutes', async () => {
    const input = createInput('MUTE');
    delete input.durationSeconds;
    await expect(cases.createCase(input)).rejects.toBeInstanceOf(InvalidModerationDurationError);
  });

  it.each([0, -1, 1.5, 2_147_483_648])(
    'rejects invalid mute duration %s',
    async (durationSeconds) => {
      await expect(
        cases.createCase(createInput('MUTE', { durationSeconds })),
      ).rejects.toBeInstanceOf(InvalidModerationDurationError);
    },
  );

  it.each(['BAN', 'BLACKLIST'] as const)('rejects duration for %s', async (type) => {
    await expect(
      cases.createCase(createInput(type, { durationSeconds: 60 })),
    ).rejects.toBeInstanceOf(InvalidModerationDurationError);
  });

  it('rejects reasons that cannot fit the future moderation presentation', async () => {
    await expect(
      cases.createCase(createInput('BAN', { reason: 'x'.repeat(1001) })),
    ).rejects.toBeInstanceOf(InvalidModerationReasonError);
  });

  it('starts case numbering at one and increments per committed case', async () => {
    const first = await cases.createCase(createInput('MUTE'));
    const second = await cases.createCase(
      createInput('BAN', { targetDiscordUserId: '970000000000000010' }),
    );
    const third = await cases.createCase(
      createInput('BLACKLIST', { targetDiscordUserId: '970000000000000011' }),
    );

    expect([first.caseNumber, second.caseNumber, third.caseNumber]).toEqual([1, 2, 3]);
    await expect(
      database.client.moderationCaseCounter.findUnique({
        where: { guildId: first.guildId },
      }),
    ).resolves.toMatchObject({ nextCaseNumber: 4 });
  });

  it('keeps case number sequences independent between guilds', async () => {
    const secondGuildBotPermId = '970000000000000012';
    await bootstrapGuild(secondGuildId, secondGuildBotPermId);

    const firstGuildCase = await cases.createCase(createInput('BAN'));
    const secondGuildCase = await cases.createCase(
      createInput('BAN', {
        authorization: authorization(secondGuildBotPermId, { guild: secondGuildId }),
      }),
    );

    expect(firstGuildCase.caseNumber).toBe(1);
    expect(secondGuildCase.caseNumber).toBe(1);
    expect(firstGuildCase.guildId).not.toBe(secondGuildCase.guildId);
  });

  it('allocates unique consecutive case numbers during concurrent creation', async () => {
    const results = await Promise.all([
      cases.createCase(createInput('BAN')),
      cases.createCase(createInput('BAN', { targetDiscordUserId: '970000000000000013' })),
    ]);

    expect(results.map(({ caseNumber }) => caseNumber).sort((a, b) => a - b)).toEqual([1, 2]);
    await expect(database.client.moderationCase.count()).resolves.toBe(2);
  });

  it.each(['MUTE', 'BAN', 'BLACKLIST'] as const)(
    'rejects a second active %s for the same guild and target',
    async (type) => {
      await cases.createCase(createInput(type));
      await expect(cases.createCase(createInput(type))).rejects.toBeInstanceOf(
        ModerationCaseAlreadyActiveError,
      );
      await expect(database.client.moderationCase.count()).resolves.toBe(1);
    },
  );

  it('enforces active uniqueness under concurrent creation', async () => {
    const results = await Promise.allSettled([
      cases.createCase(createInput('BAN')),
      cases.createCase(createInput('BAN')),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(({ status }) => status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    const rejectionReason: unknown = rejected?.status === 'rejected' ? rejected.reason : null;
    expect(rejectionReason).toBeInstanceOf(ModerationCaseAlreadyActiveError);
    await expect(database.client.moderationCase.count()).resolves.toBe(1);
  });

  it('uses database constraints as a backstop for active uniqueness and bail validity', async () => {
    const original = await cases.createCase(createInput('BAN'));
    await expect(
      database.client.moderationCase.create({
        data: {
          guildId: original.guildId,
          caseNumber: 2,
          targetUserId: original.targetUserId,
          issuedByUserId: original.issuedByUserId,
          type: 'BAN',
          bail: 10,
          issuedAt,
        },
      }),
    ).rejects.toBeDefined();

    const otherTarget = await database.client.leagueUser.create({
      data: { discordUserId: '970000000000000015' },
    });
    await expect(
      database.client.moderationCase.create({
        data: {
          guildId: original.guildId,
          caseNumber: 3,
          targetUserId: otherTarget.id,
          issuedByUserId: original.issuedByUserId,
          type: 'BLACKLIST',
          bail: -1,
          issuedAt,
        },
      }),
    ).rejects.toBeDefined();
  });

  it('allows different active punishment types to coexist', async () => {
    const created = await Promise.all(
      (['MUTE', 'BAN', 'BLACKLIST'] as const).map((type) => cases.createCase(createInput(type))),
    );

    expect(created.map(({ type }) => type).sort()).toEqual(['BAN', 'BLACKLIST', 'MUTE']);
  });

  it.each(['MUTE', 'BAN', 'BLACKLIST'] as const)(
    'resolves an active %s in place with the actual resolver',
    async (type) => {
      const original = await cases.createCase(createInput(type, { reason: 'Original reason' }));
      const resolved = await cases.resolveCase({
        authorization: moderatorAuthorization(resolverId),
        targetDiscordUserId: targetId,
        type,
        resolvedAt,
      });

      expect(resolved).toMatchObject({
        id: original.id,
        caseNumber: original.caseNumber,
        targetUserId: original.targetUserId,
        issuedByUserId: original.issuedByUserId,
        reason: 'Original reason',
        bail: 250,
        status: 'RESOLVED',
        resolutionType: 'MANUAL',
        resolvedBy: { discordUserId: resolverId },
        resolutionReason: null,
        resolvedAt,
      });
      expect(resolved.issuedAt).toEqual(original.issuedAt);
      expect(resolved.durationSeconds).toBe(original.durationSeconds);
      expect(resolved.expiresAt).toEqual(original.expiresAt);
    },
  );

  it('rejects resolution when no matching active punishment exists', async () => {
    await expect(
      cases.resolveCase({
        authorization: moderatorAuthorization(resolverId),
        targetDiscordUserId: targetId,
        type: 'BAN',
        reason: 'Nothing to resolve',
        resolvedAt,
      }),
    ).rejects.toBeInstanceOf(ModerationCaseNotActiveError);
  });

  it('allows a resolved punishment type to be issued again as a new numbered case', async () => {
    const first = await cases.createCase(createInput('BAN'));
    await cases.resolveCase({
      authorization: moderatorAuthorization(resolverId),
      targetDiscordUserId: targetId,
      type: 'BAN',
      reason: 'Appeal granted',
      resolvedAt,
    });
    const second = await cases.createCase(
      createInput('BAN', { issuedAt: new Date('2026-08-10T12:00:00.000Z') }),
    );

    expect(second).toMatchObject({ caseNumber: 2, status: 'ACTIVE' });
    await expect(
      database.client.moderationCase.findUnique({ where: { id: first.id } }),
    ).resolves.toMatchObject({
      status: 'RESOLVED',
      resolutionType: 'MANUAL',
      reason: 'Repeated misconduct',
      bail: 250,
      resolutionReason: 'Appeal granted',
    });
  });

  it('rejects a resolution timestamp earlier than the issue timestamp', async () => {
    await cases.createCase(createInput('BAN'));
    await expect(
      cases.resolveCase({
        authorization: moderatorAuthorization(resolverId),
        targetDiscordUserId: targetId,
        type: 'BAN',
        resolvedAt: new Date('2026-08-09T11:59:59.000Z'),
      }),
    ).rejects.toBeInstanceOf(InvalidModerationTimestampError);
  });

  it('returns deterministic newest-first history with complete identities and lifecycle data', async () => {
    const mute = await cases.createCase(createInput('MUTE'));
    await cases.resolveCase({
      authorization: moderatorAuthorization(resolverId),
      targetDiscordUserId: targetId,
      type: 'MUTE',
      reason: 'Served',
      resolvedAt,
    });
    const ban = await cases.createCase(
      createInput('BAN', { issuedAt: new Date('2026-08-10T12:00:00.000Z') }),
    );

    const history = await cases.listUserCases({
      authorization: moderatorAuthorization(),
      targetDiscordUserId: targetId,
    });

    expect(history.map(({ id }) => id)).toEqual([ban.id, mute.id]);
    expect(history[0]).toMatchObject({
      caseNumber: 2,
      type: 'BAN',
      status: 'ACTIVE',
      target: { discordUserId: targetId },
      issuedBy: { discordUserId: moderatorId },
      resolvedBy: null,
    });
    expect(history[1]).toMatchObject({
      caseNumber: 1,
      type: 'MUTE',
      status: 'RESOLVED',
      resolutionType: 'MANUAL',
      durationSeconds: 3600,
      expiresAt: new Date('2026-08-09T13:00:00.000Z'),
      resolvedBy: { discordUserId: resolverId },
      resolutionReason: 'Served',
      resolvedAt,
    });
  });

  it('isolates history by guild for the same Discord target', async () => {
    const secondGuildBotPermId = '970000000000000014';
    await bootstrapGuild(secondGuildId, secondGuildBotPermId);
    await cases.createCase(createInput('BAN'));
    await cases.createCase(
      createInput('BLACKLIST', {
        authorization: authorization(secondGuildBotPermId, { guild: secondGuildId }),
      }),
    );

    const firstHistory = await cases.listUserCases({
      authorization: authorization(botPermId),
      targetDiscordUserId: targetId,
    });
    const secondHistory = await cases.listUserCases({
      authorization: authorization(secondGuildBotPermId, { guild: secondGuildId }),
      targetDiscordUserId: targetId,
    });

    expect(firstHistory.map(({ type }) => type)).toEqual(['BAN']);
    expect(secondHistory.map(({ type }) => type)).toEqual(['BLACKLIST']);
  });

  it('requires moderation authorization for active-case and history reads', async () => {
    await cases.createCase(createInput('BAN'));
    await expect(
      cases.getActiveCase({
        authorization: authorization(outsiderId),
        targetDiscordUserId: targetId,
        type: 'BAN',
      }),
    ).rejects.toBeInstanceOf(ModerationAuthorizationError);
    await expect(
      cases.listUserCases({
        authorization: authorization(outsiderId),
        targetDiscordUserId: targetId,
      }),
    ).rejects.toBeInstanceOf(ModerationAuthorizationError);
  });

  it('keeps an elapsed active mute detectable from its persisted expiry', async () => {
    const elapsed = await cases.createCase(
      createInput('MUTE', {
        issuedAt: new Date('2025-01-01T00:00:00.000Z'),
        durationSeconds: 60,
      }),
    );
    const active = await cases.getActiveCase({
      authorization: moderatorAuthorization(),
      targetDiscordUserId: targetId,
      type: 'MUTE',
    });

    expect(active?.id).toBe(elapsed.id);
    expect(active?.status).toBe('ACTIVE');
    expect(active?.resolutionType).toBeNull();
    expect(active?.expiresAt?.getTime()).toBeLessThan(Date.now());
  });

  it('can persist eventual EXPIRED resolution without a human resolver', async () => {
    const elapsed = await cases.createCase(
      createInput('MUTE', {
        issuedAt: new Date('2025-01-01T00:00:00.000Z'),
        durationSeconds: 60,
      }),
    );
    const expiryResolutionTime = new Date('2025-01-01T00:01:00.000Z');

    const resolved = await new ModerationCaseRepository(database.client).resolveExpiredMute(
      elapsed.id,
      expiryResolutionTime,
    );

    expect(resolved).toMatchObject({
      id: elapsed.id,
      status: 'RESOLVED',
      resolutionType: 'EXPIRED',
      resolvedByUserId: null,
      resolvedBy: null,
      resolutionReason: null,
      resolvedAt: expiryResolutionTime,
    });
  });

  it('rejects invalid ACTIVE, MANUAL, and EXPIRED lifecycle combinations in the database', async () => {
    const mute = await cases.createCase(createInput('MUTE'));
    const resolver = await database.client.leagueUser.create({
      data: { discordUserId: '970000000000000016' },
    });

    await expect(
      database.client.moderationCase.update({
        where: { id: mute.id },
        data: { resolutionType: 'MANUAL' },
      }),
    ).rejects.toBeDefined();
    await expect(
      database.client.moderationCase.update({
        where: { id: mute.id },
        data: {
          status: 'RESOLVED',
          resolutionType: 'MANUAL',
          resolvedAt,
        },
      }),
    ).rejects.toBeDefined();
    await expect(
      database.client.moderationCase.update({
        where: { id: mute.id },
        data: {
          status: 'RESOLVED',
          resolutionType: 'EXPIRED',
          resolvedByUserId: resolver.id,
          resolvedAt,
        },
      }),
    ).rejects.toBeDefined();
    await expect(
      database.client.moderationCase.update({
        where: { id: mute.id },
        data: {
          status: 'RESOLVED',
          resolutionType: 'EXPIRED',
          resolutionReason: 'Automatic expiry',
          resolvedAt,
        },
      }),
    ).rejects.toBeDefined();

    const ban = await cases.createCase(
      createInput('BAN', { targetDiscordUserId: '970000000000000017' }),
    );
    await expect(
      database.client.moderationCase.update({
        where: { id: ban.id },
        data: {
          status: 'RESOLVED',
          resolutionType: 'EXPIRED',
          resolvedAt,
        },
      }),
    ).rejects.toBeDefined();
  });

  it('does not alter permissions, role configuration, memberships, or AuditEvent history', async () => {
    const before = {
      permissions: await database.client.botPermission.count(),
      roles: await database.client.moderationRole.count(),
      memberships: await database.client.clubMembership.count(),
      auditEvents: await database.client.auditEvent.count(),
    };

    await cases.createCase(createInput('BLACKLIST'));

    await expect(database.client.botPermission.count()).resolves.toBe(before.permissions);
    await expect(database.client.moderationRole.count()).resolves.toBe(before.roles);
    await expect(database.client.clubMembership.count()).resolves.toBe(before.memberships);
    await expect(database.client.auditEvent.count()).resolves.toBe(before.auditEvents);
  });
});
