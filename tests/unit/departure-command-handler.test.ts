import type { Club, ClubMembership, LeagueUser } from '@prisma/client';
import { ApplicationCommandOptionType, MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { commandDefinitions } from '../../src/bot/commands.js';
import { RosterDepartureCommandHandler } from '../../src/bot/departure-command-handler.js';
import type {
  ButtonInteractionAdapter,
  CommandInteraction,
  CommandInteractionOptions,
  EditedInteractionResponse,
  SafeInteractionResponse,
} from '../../src/bot/types.js';
import {
  DemandRateLimitedError,
  NotCurrentlySignedError,
  ConfirmationOwnershipError,
  StaleConfirmationError,
  WrongCommandChannelError,
} from '../../src/domain/errors.js';
import { ConfirmationRegistry } from '../../src/services/confirmation-registry.js';
import {
  demandRateLimitMs,
  GuildUserRateLimiter,
} from '../../src/services/guild-user-rate-limiter.js';
import type {
  DemandEligibility,
  ReleaseEligibility,
} from '../../src/services/roster-departure-service.js';
import type { RosterMutationResult } from '../../src/services/roster-mutation-service.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

const guildId = '100000000000000001';
const callerId = '200000000000000001';
const targetId = '200000000000000002';
const baseDate = new Date('2026-08-02T12:00:00.000Z');

function club(): Club {
  return {
    id: 'club-1',
    guildId: 'database-guild-1',
    discordRoleId: '400000000000000001',
    logoUrl: null,
    emoji: '⚽',
    squadLimitOverride: null,
    active: true,
    createdAt: baseDate,
    updatedAt: baseDate,
  };
}

function user(discordUserId: string): LeagueUser {
  return {
    id: `database-${discordUserId}`,
    discordUserId,
    robloxUserId: null,
    robloxUsername: null,
    createdAt: baseDate,
    updatedAt: baseDate,
  };
}

function membership(type = 'PLAYER'): ClubMembership {
  return {
    id: `membership-${type}`,
    guildId: 'database-guild-1',
    clubId: 'club-1',
    userId: 'database-user',
    membershipType: type,
    status: 'ACTIVE',
    joinedAt: baseDate,
    leftAt: null,
    createdByUserId: null,
    endedByUserId: null,
    createdAt: baseDate,
    updatedAt: baseDate,
  };
}

function demandEligibility(staffRole: 'ATM' | 'PM' | null = null): DemandEligibility {
  return {
    club: club(),
    user: user(callerId),
    playerMembership: membership(),
    staffType:
      staffRole === 'ATM' ? 'ASSISTANT_MANAGER' : staffRole === 'PM' ? 'PLAYER_MANAGER' : null,
    staffRole,
  };
}

function releaseEligibility(targetStaffRole: 'ATM' | 'PM' | null = null): ReleaseEligibility {
  return {
    club: club(),
    callerStaffType: 'TEAM_MANAGER',
    callerStaffRole: 'TM',
    target: user(targetId),
    targetPlayerMembership: membership(),
    targetStaffType:
      targetStaffRole === 'ATM'
        ? 'ASSISTANT_MANAGER'
        : targetStaffRole === 'PM'
          ? 'PLAYER_MANAGER'
          : null,
    targetStaffRole,
  };
}

class Options implements CommandInteractionOptions {
  public constructor(private readonly playerId: string | null = null) {}
  public getSubcommand(): string | null {
    return null;
  }
  public getString(): string | null {
    return null;
  }
  public getInteger(): number | null {
    return null;
  }
  public getUser(name: string): { id: string; bot: boolean; displayName?: string } | null {
    return name === 'player' && this.playerId
      ? { id: this.playerId, bot: false, displayName: 'Target Player' }
      : null;
  }
  public getRole(): { id: string } | null {
    return null;
  }
  public getChannel(): { id: string; type: number } | null {
    return null;
  }
}

class FakeCommandInteraction implements CommandInteraction {
  public replied = false;
  public deferred = false;
  public readonly guildId = guildId;
  public readonly guildName = 'Stage 4B League';
  public readonly guildOwnerId = '200000000000000099';
  public readonly userId = callerId;
  public readonly userDisplayName = 'Caller';
  public readonly channelId: string;
  public readonly memberRoleIds: readonly string[] = [];
  public readonly hasAdministratorPermission = false;
  public readonly options: CommandInteractionOptions;
  public readonly deferrals: Array<{ flags?: MessageFlags.Ephemeral }> = [];
  public readonly edits: EditedInteractionResponse[] = [];
  public readonly replies: SafeInteractionResponse[] = [];
  public readonly followUps: SafeInteractionResponse[] = [];

  public constructor(
    public readonly commandName: 'demand' | 'release',
    playerId: string | null = null,
    channelId = '300000000000000001',
  ) {
    this.options = new Options(playerId);
    this.channelId = channelId;
  }

  public getGuildRoleMetadata(roleId: string) {
    return { id: roleId, name: 'T1', color: 0xf97316 };
  }
  public getGuildMemberDisplayName(id: string): string | null {
    return id === targetId ? 'Target Player' : 'Caller';
  }
  public reply(response: SafeInteractionResponse): Promise<void> {
    this.replies.push(response);
    this.replied = true;
    return Promise.resolve();
  }
  public deferReply(response?: { flags?: MessageFlags.Ephemeral }): Promise<void> {
    this.deferrals.push(response ?? {});
    this.deferred = true;
    return Promise.resolve();
  }
  public editReply(response: EditedInteractionResponse): Promise<void> {
    this.edits.push(response);
    this.replied = true;
    return Promise.resolve();
  }
  public followUp(response: SafeInteractionResponse): Promise<void> {
    this.followUps.push(response);
    return Promise.resolve();
  }
  public deleteReply(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeButton implements ButtonInteractionAdapter {
  public replied = false;
  public deferred = false;
  public readonly guildId = guildId;
  public readonly edits: EditedInteractionResponse[] = [];
  public readonly replies: SafeInteractionResponse[] = [];
  public readonly followUps: SafeInteractionResponse[] = [];

  public constructor(
    public readonly customId: string,
    public readonly userId = callerId,
  ) {}
  public getGuildRoleMetadata(roleId: string) {
    return { id: roleId, name: 'T1', color: 0xf97316 };
  }
  public getGuildMemberDisplayName(id: string): string | null {
    return id === targetId ? 'Target Player' : 'Caller';
  }
  public deferUpdate(): Promise<void> {
    this.deferred = true;
    return Promise.resolve();
  }
  public reply(response: SafeInteractionResponse): Promise<void> {
    this.replies.push(response);
    this.replied = true;
    return Promise.resolve();
  }
  public editReply(response: EditedInteractionResponse): Promise<void> {
    this.edits.push(response);
    this.replied = true;
    return Promise.resolve();
  }
  public followUp(response: SafeInteractionResponse): Promise<void> {
    this.followUps.push(response);
    return Promise.resolve();
  }
}

function buttonJson(interaction: FakeCommandInteraction) {
  const row = interaction.edits.at(-1)?.components?.[0];
  if (!row) throw new Error('missing confirmation buttons');
  return row.components.map(
    (button) =>
      button.toJSON() as {
        custom_id?: string;
        label?: string;
        style: number;
      },
  );
}

function mutationResult(): RosterMutationResult {
  return {
    club: club(),
    announcementDelivered: true,
  } as RosterMutationResult;
}

function setup(staffRole: 'ATM' | 'PM' | null = null) {
  let nowMs = baseDate.getTime();
  const policy = { validateChannelPolicy: vi.fn(() => Promise.resolve()) };
  const departures = {
    getDemandEligibility: vi.fn(() => Promise.resolve(demandEligibility(staffRole))),
    getReleaseEligibility: vi.fn(() => Promise.resolve(releaseEligibility())),
    leaveStaffPosition: vi.fn(() => Promise.resolve(mutationResult())),
    demandFullDeparture: vi.fn(() => Promise.resolve(mutationResult())),
    release: vi.fn(() => Promise.resolve(mutationResult())),
  };
  const confirmations = new ConfirmationRegistry(new MemoryLogger());
  const handler = new RosterDepartureCommandHandler(
    policy,
    departures,
    confirmations,
    new GuildUserRateLimiter(demandRateLimitMs, () => nowMs),
    () => new Date(nowMs),
  );
  return {
    handler,
    policy,
    departures,
    confirmations,
    advance(ms: number) {
      nowMs += ms;
    },
  };
}

describe('Stage 4B.2 departure command registration', () => {
  it('registers /demand without options and /release with only required player', () => {
    const demand = commandDefinitions.find(({ data }) => data.name === 'demand')?.data.toJSON();
    const release = commandDefinitions.find(({ data }) => data.name === 'release')?.data.toJSON();
    expect(demand?.options ?? []).toEqual([]);
    expect(release?.options).toEqual([
      expect.objectContaining({
        name: 'player',
        type: ApplicationCommandOptionType.User,
        required: true,
      }),
    ]);
  });
});

describe('/demand confirmation flow', () => {
  it('shows only Demand and Cancel for an ordinary player and starts the fixed window', async () => {
    const { handler, confirmations } = setup();
    const interaction = new FakeCommandInteraction('demand');
    await handler.beginDemand(interaction);
    expect(interaction.deferrals).toEqual([{ flags: MessageFlags.Ephemeral }]);
    expect(buttonJson(interaction).map(({ label }) => label)).toEqual(['Demand', 'Cancel']);
    await expect(handler.beginDemand(new FakeCommandInteraction('demand'))).rejects.toBeInstanceOf(
      DemandRateLimitedError,
    );
    confirmations.clear();
  });

  it.each([
    ['ATM', 'Assistant Team Manager'],
    ['PM', 'Player Manager'],
  ] as const)('shows both departure modes for %s', async (role, label) => {
    const { handler, confirmations } = setup(role);
    const interaction = new FakeCommandInteraction('demand');
    await handler.beginDemand(interaction);
    expect(buttonJson(interaction).map(({ label: buttonLabel }) => buttonLabel)).toEqual([
      'Leave Staff Position',
      'Leave Team Completely',
      'Cancel',
    ]);
    expect(interaction.edits[0]?.embeds?.[0]?.data.description).toContain(label);
    confirmations.clear();
  });

  it('keeps the cooldown after a blocked eligibility attempt', async () => {
    const fixture = setup();
    fixture.departures.getDemandEligibility.mockRejectedValueOnce(new NotCurrentlySignedError());
    await expect(
      fixture.handler.beginDemand(new FakeCommandInteraction('demand')),
    ).rejects.toBeInstanceOf(NotCurrentlySignedError);
    await expect(
      fixture.handler.beginDemand(new FakeCommandInteraction('demand')),
    ).rejects.toBeInstanceOf(DemandRateLimitedError);
    fixture.confirmations.clear();
  });

  it('does not start the cooldown or create a confirmation in the wrong channel', async () => {
    const fixture = setup();
    fixture.policy.validateChannelPolicy.mockRejectedValueOnce(
      new WrongCommandChannelError(['300000000000000001'], 'bot_or_staff'),
    );
    const blocked = new FakeCommandInteraction('demand', null, 'transfer-market');
    await expect(fixture.handler.beginDemand(blocked)).rejects.toBeInstanceOf(
      WrongCommandChannelError,
    );
    expect(blocked.deferrals).toEqual([{ flags: MessageFlags.Ephemeral }]);
    expect(blocked.edits).toEqual([]);
    expect(fixture.departures.getDemandEligibility).not.toHaveBeenCalled();
    expect(fixture.departures.demandFullDeparture).not.toHaveBeenCalled();

    const allowed = new FakeCommandInteraction('demand');
    await expect(fixture.handler.beginDemand(allowed)).resolves.toBeUndefined();
    expect(buttonJson(allowed).map(({ label }) => label)).toEqual(['Demand', 'Cancel']);
    fixture.confirmations.clear();
  });

  it('reports decreasing time and a wrong-channel retry does not refresh the fixed window', async () => {
    const fixture = setup();
    await fixture.handler.beginDemand(new FakeCommandInteraction('demand'));
    fixture.advance(30_000);

    await expect(
      fixture.handler.beginDemand(new FakeCommandInteraction('demand')),
    ).rejects.toMatchObject({ remainingSeconds: 30 });
    fixture.policy.validateChannelPolicy.mockRejectedValueOnce(
      new WrongCommandChannelError(['300000000000000001'], 'bot_or_staff'),
    );
    await expect(
      fixture.handler.beginDemand(new FakeCommandInteraction('demand', null, 'audit')),
    ).rejects.toBeInstanceOf(WrongCommandChannelError);

    fixture.advance(30_000);
    await expect(
      fixture.handler.beginDemand(new FakeCommandInteraction('demand')),
    ).resolves.toBeUndefined();
    fixture.confirmations.clear();
  });

  it('cancels without mutation and rejects a different user', async () => {
    const fixture = setup();
    const command = new FakeCommandInteraction('demand');
    await fixture.handler.beginDemand(command);
    const buttons = buttonJson(command);
    const cancelId = buttons.find(({ label }) => label === 'Cancel')?.custom_id;
    if (!cancelId) throw new Error('missing cancel id');
    await expect(
      fixture.handler.handleButton(new FakeButton(cancelId, targetId)),
    ).rejects.toBeInstanceOf(ConfirmationOwnershipError);
    const button = new FakeButton(cancelId);
    await expect(fixture.handler.handleButton(button)).resolves.toBe(true);
    expect(fixture.departures.demandFullDeparture).not.toHaveBeenCalled();
    expect(button.edits[0]?.components).toEqual([]);
    fixture.advance(demandRateLimitMs - 1);
    await expect(
      fixture.handler.beginDemand(new FakeCommandInteraction('demand')),
    ).rejects.toBeInstanceOf(DemandRateLimitedError);
    fixture.advance(1);
    await expect(
      fixture.handler.beginDemand(new FakeCommandInteraction('demand')),
    ).resolves.toBeUndefined();
    fixture.confirmations.clear();
  });

  it('expires at two minutes, removes buttons, and does not restart the cooldown', async () => {
    const fixture = setup();
    const command = new FakeCommandInteraction('demand');
    await fixture.handler.beginDemand(command);
    const confirmId = buttonJson(command).find(({ label }) => label === 'Demand')?.custom_id;
    const confirmationId = confirmId?.split(':')[1];
    if (!confirmationId) throw new Error('missing confirmation id');
    fixture.advance(2 * 60_000);
    expect(
      fixture.confirmations.expire(confirmationId, new Date(baseDate.getTime() + 2 * 60_000)),
    ).toBe(true);
    await vi.waitFor(() => {
      expect(command.edits.at(-1)?.embeds?.[0]?.data.title).toBe('❌ Confirmation Expired');
    });
    expect(command.edits.at(-1)?.components).toEqual([]);
    await expect(
      fixture.handler.beginDemand(new FakeCommandInteraction('demand')),
    ).resolves.toBeUndefined();
    fixture.confirmations.clear();
  });

  it('performs full departure once and rejects a double confirmation', async () => {
    const fixture = setup();
    const command = new FakeCommandInteraction('demand');
    await fixture.handler.beginDemand(command);
    const confirmId = buttonJson(command).find(({ label }) => label === 'Demand')?.custom_id;
    if (!confirmId) throw new Error('missing demand id');
    const button = new FakeButton(confirmId);
    fixture.departures.getDemandEligibility.mockImplementationOnce(() => {
      expect(button.deferred).toBe(true);
      return Promise.resolve(demandEligibility());
    });
    await expect(fixture.handler.handleButton(button)).resolves.toBe(true);
    expect(fixture.departures.demandFullDeparture).toHaveBeenCalledOnce();
    await expect(fixture.handler.handleButton(new FakeButton(confirmId))).rejects.toThrow(
      'already been handled',
    );
    fixture.confirmations.clear();
  });

  it('uses only the staff-only mutation for the staff-position choice', async () => {
    const fixture = setup('PM');
    const command = new FakeCommandInteraction('demand');
    await fixture.handler.beginDemand(command);
    const staffOnlyId = buttonJson(command).find(
      ({ label }) => label === 'Leave Staff Position',
    )?.custom_id;
    if (!staffOnlyId) throw new Error('missing staff-only id');
    await fixture.handler.handleButton(new FakeButton(staffOnlyId));
    expect(fixture.departures.leaveStaffPosition).toHaveBeenCalledOnce();
    expect(fixture.departures.demandFullDeparture).not.toHaveBeenCalled();
    fixture.confirmations.clear();
  });

  it('describes staff-only departure without claiming a PLAYER membership remains', async () => {
    const fixture = setup('PM');
    fixture.departures.getDemandEligibility.mockResolvedValue({
      ...demandEligibility('PM'),
      playerMembership: null,
    });
    const command = new FakeCommandInteraction('demand');
    await fixture.handler.beginDemand(command);
    expect(command.edits[0]?.embeds?.[0]?.data.description).toContain(
      'ends your only active team membership',
    );
    const staffOnlyId = buttonJson(command).find(
      ({ label }) => label === 'Leave Staff Position',
    )?.custom_id;
    if (!staffOnlyId) throw new Error('missing staff-only id');
    const button = new FakeButton(staffOnlyId);
    await fixture.handler.handleButton(button);
    expect(button.edits[0]?.embeds?.[0]?.data.description).toContain('now a free agent');
    fixture.confirmations.clear();
  });

  it('consumes a confirmation but makes no mutation when the bound staff state changed', async () => {
    const fixture = setup('ATM');
    const command = new FakeCommandInteraction('demand');
    await fixture.handler.beginDemand(command);
    const fullId = buttonJson(command).find(
      ({ label }) => label === 'Leave Team Completely',
    )?.custom_id;
    if (!fullId) throw new Error('missing full-demand id');
    fixture.departures.getDemandEligibility.mockResolvedValueOnce(demandEligibility('PM'));
    await expect(fixture.handler.handleButton(new FakeButton(fullId))).rejects.toBeInstanceOf(
      StaleConfirmationError,
    );
    expect(fixture.departures.demandFullDeparture).not.toHaveBeenCalled();
    fixture.confirmations.clear();
  });
});

describe('/release confirmation flow', () => {
  it('shows only Release and Cancel after channel policy succeeds', async () => {
    const fixture = setup();
    const interaction = new FakeCommandInteraction('release', targetId);
    await fixture.handler.beginRelease(interaction);
    expect(interaction.deferrals).toEqual([{ flags: MessageFlags.Ephemeral }]);
    expect(buttonJson(interaction).map(({ label }) => label)).toEqual(['Release', 'Cancel']);
    expect(fixture.policy.validateChannelPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ commandName: 'release', channelId: '300000000000000001' }),
    );
    fixture.confirmations.clear();
  });

  it('rejects Transfer Market ephemerally before eligibility or confirmation', async () => {
    const fixture = setup();
    fixture.policy.validateChannelPolicy.mockRejectedValueOnce(
      new WrongCommandChannelError(['300000000000000001'], 'bot_or_staff'),
    );
    const interaction = new FakeCommandInteraction('release', targetId, 'transfer-market');
    await expect(fixture.handler.beginRelease(interaction)).rejects.toBeInstanceOf(
      WrongCommandChannelError,
    );
    expect(interaction.deferrals).toEqual([{ flags: MessageFlags.Ephemeral }]);
    expect(interaction.edits).toEqual([]);
    expect(fixture.departures.getReleaseEligibility).not.toHaveBeenCalled();
    expect(fixture.departures.release).not.toHaveBeenCalled();
  });

  it('lets only the caller confirm and performs the release once', async () => {
    const fixture = setup();
    const command = new FakeCommandInteraction('release', targetId);
    await fixture.handler.beginRelease(command);
    const releaseId = buttonJson(command).find(({ label }) => label === 'Release')?.custom_id;
    if (!releaseId) throw new Error('missing release id');
    await expect(
      fixture.handler.handleButton(new FakeButton(releaseId, targetId)),
    ).rejects.toBeInstanceOf(ConfirmationOwnershipError);
    const button = new FakeButton(releaseId);
    fixture.departures.getReleaseEligibility.mockImplementationOnce(() => {
      expect(button.deferred).toBe(true);
      return Promise.resolve(releaseEligibility());
    });
    await expect(fixture.handler.handleButton(button)).resolves.toBe(true);
    expect(fixture.departures.release).toHaveBeenCalledOnce();
    expect(button.edits[0]?.embeds?.[0]?.data.title).toBe('✅ Player Released');
    fixture.confirmations.clear();
  });

  it('rejects a stale target rank without mutation', async () => {
    const fixture = setup();
    const command = new FakeCommandInteraction('release', targetId);
    await fixture.handler.beginRelease(command);
    const releaseId = buttonJson(command).find(({ label }) => label === 'Release')?.custom_id;
    if (!releaseId) throw new Error('missing release id');
    fixture.departures.getReleaseEligibility.mockResolvedValueOnce(releaseEligibility('PM'));
    await expect(fixture.handler.handleButton(new FakeButton(releaseId))).rejects.toBeInstanceOf(
      StaleConfirmationError,
    );
    expect(fixture.departures.release).not.toHaveBeenCalled();
    fixture.confirmations.clear();
  });

  it('surfaces delivery warnings for Audit and Transfer failures on release', async () => {
    const fixture = setup();
    const command = new FakeCommandInteraction('release', targetId);
    await fixture.handler.beginRelease(command);
    const releaseId = buttonJson(command).find(({ label }) => label === 'Release')?.custom_id;
    if (!releaseId) throw new Error('missing release id');

    fixture.departures.release.mockResolvedValueOnce({
      ...mutationResult(),
      announcementDelivered: false,
      auditAnnouncementDelivered: false,
    });
    const button = new FakeButton(releaseId);
    await fixture.handler.handleButton(button);
    expect(button.edits[0]?.embeds?.[0]?.data.description).toContain(
      '⚠️ The roster was updated, but the Audit and Transfer Market announcements could not be delivered.',
    );
  });
});
