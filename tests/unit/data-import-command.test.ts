import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import { commandDefinitions } from '../../src/bot/commands.js';
import { DiscordCommandInteraction } from '../../src/bot/interaction-handler.js';
import type {
  CommandContext,
  CommandInteraction,
  DeferredInteractionResponse,
  EditedInteractionResponse,
  SafeInteractionResponse,
} from '../../src/bot/types.js';
import { AdministrativePermissionDeniedError } from '../../src/domain/errors.js';
import { CommandChannelPolicyService } from '../../src/services/command-channel-policy-service.js';
import type {
  DataImportInput,
  DataImportResult,
  GuildMemberSnapshot,
} from '../../src/services/data-import-service.js';
import { MemoryLogger } from '../helpers/memory-logger.js';

const dataCommand = commandDefinitions.find(({ data }) => data.name === 'data')!;
const actorId = '960000000000000001';
const guildId = '960000000000000002';
const staffChannelId = '960000000000000003';
const auditChannelId = '960000000000000004';

class DataCommandInteraction implements CommandInteraction {
  public readonly commandName = 'data';
  public replied = false;
  public deferred = false;
  public readonly guildId = guildId;
  public readonly guildName = 'Import Command League';
  public readonly guildIconUrl = 'https://cdn.example.test/guild.png';
  public readonly guildOwnerId = '960000000000000099';
  public readonly userId = actorId;
  public readonly userDisplayName = 'Import Admin';
  public readonly channelId = staffChannelId;
  public readonly memberRoleIds: readonly string[] = [];
  public readonly hasAdministratorPermission = false;
  public readonly deferredResponses: DeferredInteractionResponse[] = [];
  public readonly editedResponses: EditedInteractionResponse[] = [];
  public readonly followUps: SafeInteractionResponse[] = [];
  public readonly fetchGuildMembers = vi.fn<() => Promise<readonly GuildMemberSnapshot[]>>(() =>
    Promise.resolve([]),
  );
  public readonly options = {
    getSubcommand: () => 'import',
    getSubcommandGroup: () => null,
    getString: () => null,
    getInteger: () => null,
    getUser: () => null,
    getRole: () => null,
    getChannel: () => null,
  };

  public reply(response: SafeInteractionResponse): Promise<void> {
    this.replied = true;
    this.followUps.push(response);
    return Promise.resolve();
  }

  public deferReply(response?: DeferredInteractionResponse): Promise<void> {
    this.deferred = true;
    this.deferredResponses.push(response ?? {});
    return Promise.resolve();
  }

  public editReply(response: EditedInteractionResponse): Promise<void> {
    this.replied = true;
    this.editedResponses.push(response);
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

function result(issueCount = 0): DataImportResult {
  const occurredAt = new Date('2026-08-08T20:00:00.000Z');
  return {
    guild: {
      id: 'internal-guild',
      discordGuildId: guildId,
      name: 'Import Command League',
      createdAt: occurredAt,
      updatedAt: occurredAt,
    },
    settings: {
      id: 'settings',
      guildId: 'internal-guild',
      botCommandsChannelId: '960000000000000010',
      staffChannelId,
      transferChannelId: '960000000000000011',
      auditChannelId,
      caseFilesChannelId: '960000000000000016',
      botPermissionsRoleId: '960000000000000012',
      teamManagerRoleId: '960000000000000013',
      assistantManagerRoleId: '960000000000000014',
      playerManagerRoleId: '960000000000000015',
      defaultSquadLimit: 17,
      offerTimeoutSeconds: 86400,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    },
    imported: { players: 3, teamManagers: 1, assistantManagers: 1, playerManagers: 1 },
    unchanged: 2,
    issues: Array.from({ length: issueCount }, (_, index) => ({
      code: 'CONFLICTING_MEMBERSHIP' as const,
      discordUserId: `97${String(index).padStart(16, '0')}`,
      displayName: `Conflicting Member ${String(index).padStart(3, '0')}`,
      reason: 'conflicting active database membership',
    })),
    scannedMembers: 500,
    ignoredBots: 4,
    occurredAt,
  };
}

function context(importResult: DataImportResult, policy = vi.fn(() => Promise.resolve())) {
  const publish = vi.fn(() => Promise.resolve(true));
  const importGuild = vi.fn(async (input: DataImportInput) => {
    await input.fetchMembers();
    return importResult;
  });
  const commandContext = {
    logger: new MemoryLogger(),
    commandChannelPolicyService: { validateChannelPolicy: policy },
    dataImportService: { importGuild },
    setupAuditService: { publish },
  } as unknown as CommandContext;
  return { commandContext, importGuild, publish, policy };
}

describe('/data import command', () => {
  it('registers exactly the import subcommand', () => {
    const json = dataCommand.data.toJSON();
    expect(json.name).toBe('data');
    expect(json.options).toEqual([
      expect.objectContaining({ name: 'import', type: 1, options: [] }),
    ]);
  });

  it('is classified as a Staff Commands-only administrative mutation', () => {
    const policy = new CommandChannelPolicyService({} as never);
    expect(policy.getScope('data', 'import')).toBe('STAFF_ONLY');
  });

  it('loads the complete Discord guild-member collection with one fetch call', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Map([
          [
            '990000000000000001',
            {
              id: '990000000000000001',
              displayName: 'Visible Player',
              roles: { cache: new Map([['990000000000000010', {}]]) },
              user: { bot: false, globalName: 'Global Player', username: 'player' },
            },
          ],
          [
            '990000000000000002',
            {
              id: '990000000000000002',
              displayName: 'Import Bot',
              roles: { cache: new Map() },
              user: { bot: true, globalName: null, username: 'bot' },
            },
          ],
        ]),
      ),
    );
    const adapter = new DiscordCommandInteraction(
      { guild: { members: { fetch } } } as never,
      new MemoryLogger(),
    );

    await expect(adapter.fetchGuildMembers()).resolves.toEqual([
      {
        discordUserId: '990000000000000001',
        displayName: 'Visible Player',
        roleIds: ['990000000000000010'],
        bot: false,
      },
      {
        discordUserId: '990000000000000002',
        displayName: 'Import Bot',
        roleIds: [],
        bot: true,
      },
    ]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('fetches guild members once, publishes one aggregate Audit message, and stays ephemeral', async () => {
    const interaction = new DataCommandInteraction();
    const setup = context(result(300));

    await dataCommand.execute(interaction, setup.commandContext);

    expect(setup.policy).toHaveBeenCalledWith(
      expect.objectContaining({
        commandName: 'data',
        subcommand: 'import',
        channelId: staffChannelId,
      }),
    );
    expect(interaction.deferredResponses).toEqual([{ flags: MessageFlags.Ephemeral }]);
    expect(interaction.fetchGuildMembers).toHaveBeenCalledOnce();
    expect(setup.importGuild).toHaveBeenCalledOnce();
    expect(setup.publish).toHaveBeenCalledOnce();
    expect(setup.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: auditChannelId,
        actorDiscordUserId: actorId,
        actorVerb: 'Imported',
      }),
    );
    expect(interaction.editedResponses).toHaveLength(1);
    expect(interaction.editedResponses[0]?.embeds).toHaveLength(10);
    expect(interaction.followUps.length).toBeGreaterThan(0);
    expect(interaction.followUps.every(({ flags }) => flags === MessageFlags.Ephemeral)).toBe(true);
    const firstEmbed = interaction.editedResponses[0]?.embeds?.[0]?.toJSON();
    expect(firstEmbed?.author).toMatchObject({ name: 'Import Command League' });
    expect(firstEmbed?.footer?.text).toContain('Imported by Import Admin');
    expect(firstEmbed?.timestamp).toBe('2026-08-08T20:00:00.000Z');
    expect(firstEmbed?.fields?.map(({ name }) => name)).toEqual([
      'Imported',
      'Unchanged',
      'Skipped / Issues (300)',
    ]);
  });

  it('defers before policy but does not fetch, import, or audit after authorization denial', async () => {
    const interaction = new DataCommandInteraction();
    const policy = vi.fn(() => Promise.reject(new AdministrativePermissionDeniedError()));
    const setup = context(result(), policy);

    await expect(dataCommand.execute(interaction, setup.commandContext)).rejects.toBeInstanceOf(
      AdministrativePermissionDeniedError,
    );
    expect(interaction.deferredResponses).toEqual([{ flags: MessageFlags.Ephemeral }]);
    expect(interaction.fetchGuildMembers).not.toHaveBeenCalled();
    expect(setup.importGuild).not.toHaveBeenCalled();
    expect(setup.publish).not.toHaveBeenCalled();
  });
});
