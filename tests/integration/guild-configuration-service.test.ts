import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { GuildConfigurationNotFoundError } from '../../src/domain/errors.js';
import { ClubRepository } from '../../src/repositories/club-repository.js';
import { GuildRepository } from '../../src/repositories/guild-repository.js';
import { GuildConfigurationService } from '../../src/services/guild-configuration-service.js';
import {
  clearDatabase,
  createTestDatabase,
  destroyTestDatabase,
  type TestDatabase,
} from '../helpers/database.js';

describe('guild configuration service', () => {
  let database: TestDatabase;
  let guilds: GuildRepository;
  let clubs: ClubRepository;
  let service: GuildConfigurationService;

  beforeAll(() => {
    database = createTestDatabase();
    guilds = new GuildRepository(database.client);
    clubs = new ClubRepository(database.client);
    service = new GuildConfigurationService(guilds, clubs);
  });

  beforeEach(async () => {
    await clearDatabase(database.client);
  });

  afterAll(async () => {
    await destroyTestDatabase(database);
  });

  it('loads database-backed guild settings and active clubs', async () => {
    const guild = await guilds.create({
      discordGuildId: '710000000000000001',
      name: 'configured guild',
    });
    const settings = await guilds.upsertSettings(guild.id, {
      transferChannelId: '720000000000000001',
      offerTimeoutSeconds: 600,
    });
    const activeClub = await clubs.create({
      guildId: guild.id,
      name: 'configured club',
      shortName: 'CFG',
      discordRoleId: '730000000000000001',
      squadLimit: 20,
    });
    const result = await service.load(guild.discordGuildId);
    expect(result).toEqual({ guild, settings, activeClubs: [activeClub] });
    expect(result.settings.transferChannelId).toBe('720000000000000001');
    expect(result.activeClubs[0]?.discordRoleId).toBe('730000000000000001');
  });

  it('throws a typed error for a missing guild', async () => {
    const error = await service.load('710000000000000099').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GuildConfigurationNotFoundError);
    expect((error as GuildConfigurationNotFoundError).missingResource).toBe('guild');
  });

  it('throws a typed error for missing guild settings', async () => {
    const guild = await guilds.create({
      discordGuildId: '710000000000000001',
      name: 'missing settings',
    });
    const error = await service.load(guild.discordGuildId).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GuildConfigurationNotFoundError);
    expect((error as GuildConfigurationNotFoundError).missingResource).toBe('settings');
  });

  it('excludes inactive clubs', async () => {
    const guild = await guilds.create({
      discordGuildId: '710000000000000001',
      name: 'configured guild',
    });
    await guilds.upsertSettings(guild.id, {});
    const active = await clubs.create({
      guildId: guild.id,
      name: 'active club',
      shortName: 'ACT',
      discordRoleId: '730000000000000001',
      squadLimit: 17,
    });
    const inactive = await clubs.create({
      guildId: guild.id,
      name: 'inactive club',
      shortName: 'INA',
      discordRoleId: '730000000000000002',
      squadLimit: 17,
    });
    await clubs.deactivate(inactive.id);
    await expect(service.load(guild.discordGuildId)).resolves.toMatchObject({
      activeClubs: [active],
    });
  });
});
