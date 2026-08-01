import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  applyMigrations,
  createTestDatabase,
  destroyTestDatabase,
  type TestDatabase,
} from '../helpers/database.js';

interface NameRow {
  name: string;
}

interface SqlRow {
  name: string;
  sql: string;
}

interface ForeignKeyRow {
  id: number;
  table: string;
  from: string;
  to: string;
}

interface BannerSettingsRow {
  bannerHasEmoji: number;
  bannerHasName: number;
  bannerHasShort: number;
  bannerHasRole: number;
  botCommandsChannelId: string;
  defaultSquadLimit: number;
}

describe('database migrations', () => {
  let database: TestDatabase;

  beforeAll(() => {
    database = createTestDatabase();
  });

  afterAll(async () => {
    await destroyTestDatabase(database);
  });

  it('applies to a fresh file and creates every required table', () => {
    const sqlite = new DatabaseSync(database.databasePath, { readOnly: true });
    try {
      const names = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as unknown as NameRow[];
      expect(names.map(({ name }) => name)).toEqual(
        expect.arrayContaining([
          'Guild',
          'GuildSettings',
          'Club',
          'LeagueUser',
          'ClubMembership',
          'Offer',
          'LeagueTransaction',
          'AuditEvent',
          '_prisma_migrations',
        ]),
      );
    } finally {
      sqlite.close();
    }
  });

  it('contains every required partial unique index', () => {
    const sqlite = new DatabaseSync(database.databasePath, { readOnly: true });
    try {
      const indexes = sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND sql LIKE '%WHERE%' ORDER BY name",
        )
        .all() as unknown as NameRow[];
      expect(indexes.map(({ name }) => name)).toEqual([
        'ClubMembership_one_active_assistant_manager_per_club',
        'ClubMembership_one_active_player_manager_per_club',
        'ClubMembership_one_active_player_per_guild',
        'ClubMembership_one_active_team_manager_per_club',
        'Offer_one_pending_per_club_player',
      ]);
    } finally {
      sqlite.close();
    }
  });

  it('contains composite club foreign keys and state consistency checks', () => {
    const sqlite = new DatabaseSync(database.databasePath, { readOnly: true });
    try {
      const tables = sqlite
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN ('ClubMembership', 'Offer', 'LeagueTransaction') ORDER BY name",
        )
        .all() as unknown as SqlRow[];
      const sqlByTable = new Map(tables.map(({ name, sql }) => [name, sql]));
      expect(sqlByTable.get('ClubMembership')).toContain('ClubMembership_status_timestamps_check');
      expect(sqlByTable.get('Offer')).toContain('Offer_status_timestamps_check');

      for (const [table, expectedMappings] of [
        ['ClubMembership', [['clubId->id', 'guildId->guildId']]],
        ['Offer', [['clubId->id', 'guildId->guildId']]],
        [
          'LeagueTransaction',
          [
            ['destinationClubId->id', 'guildId->guildId'],
            ['guildId->guildId', 'sourceClubId->id'],
          ],
        ],
      ] as const) {
        const foreignKeys = sqlite
          .prepare(`PRAGMA foreign_key_list("${table}")`)
          .all() as unknown as ForeignKeyRow[];
        const clubGroups = new Map<number, ForeignKeyRow[]>();
        for (const foreignKey of foreignKeys.filter((candidate) => candidate.table === 'Club')) {
          const group = clubGroups.get(foreignKey.id);
          if (group === undefined) {
            clubGroups.set(foreignKey.id, [foreignKey]);
          } else {
            group.push(foreignKey);
          }
        }
        const mappings = [...clubGroups.values()]
          .map((group) => group.map((row) => `${row.from}->${row.to}`).sort())
          .sort((left, right) => left.join().localeCompare(right.join()));
        expect(mappings).toEqual(expectedMappings);
      }
    } finally {
      sqlite.close();
    }
  });

  it('can recreate the schema from zero', async () => {
    const second = createTestDatabase();
    try {
      await expect(second.client.guild.count()).resolves.toBe(0);
      applyMigrations(second.databaseUrl);
      await expect(second.client.guild.count()).resolves.toBe(0);
    } finally {
      await destroyTestDatabase(second);
    }
  });

  it('defaults team banners to emoji and role on a fresh database', async () => {
    const guild = await database.client.guild.create({
      data: { discordGuildId: '100000000000000001', name: 'Banner League' },
    });
    const settings = await database.client.guildSettings.create({ data: { guildId: guild.id } });
    expect(settings).toMatchObject({
      bannerHasEmoji: true,
      bannerHasName: false,
      bannerHasShort: false,
      bannerHasRole: true,
    });
  });

  it('corrects Stage 4A defaults without changing saved banner settings', () => {
    const databasePath = join(process.cwd(), 'prisma', `.stage4a-${randomUUID()}.db`);
    writeFileSync(databasePath, '', { flag: 'wx' });
    const sqlite = new DatabaseSync(databasePath);
    try {
      for (const migration of [
        '20260731130000_initial_foundation',
        '20260801000000_setup_channels_and_squad_limits',
        '20260801140000_rename_bot_permissions_role',
      ]) {
        sqlite.exec(
          readFileSync(join(process.cwd(), 'prisma', 'migrations', migration, 'migration.sql'), {
            encoding: 'utf8',
          }),
        );
      }
      sqlite
        .prepare(
          'INSERT INTO "Guild" ("id", "discordGuildId", "name", "updatedAt") VALUES (?, ?, ?, ?)',
        )
        .run('guild-1', '100000000000000002', 'Existing League', new Date().toISOString());
      sqlite
        .prepare(
          'INSERT INTO "GuildSettings" ("id", "guildId", "botCommandsChannelId", "defaultSquadLimit", "offerTimeoutSeconds", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('settings-1', 'guild-1', '200000000000000001', 23, 7200, new Date().toISOString());

      sqlite.exec(
        readFileSync(
          join(
            process.cwd(),
            'prisma',
            'migrations',
            '20260801190000_team_banner_configuration',
            'migration.sql',
          ),
          { encoding: 'utf8' },
        ),
      );
      sqlite
        .prepare(
          'UPDATE "GuildSettings" SET "bannerHasEmoji" = ?, "bannerHasName" = ?, "bannerHasShort" = ?, "bannerHasRole" = ? WHERE "id" = ?',
        )
        .run(0, 1, 1, 0, 'settings-1');
      sqlite.exec(
        readFileSync(
          join(
            process.cwd(),
            'prisma',
            'migrations',
            '20260801210000_correct_team_banner_defaults',
            'migration.sql',
          ),
          { encoding: 'utf8' },
        ),
      );

      const settings = sqlite
        .prepare(
          'SELECT "bannerHasEmoji", "bannerHasName", "bannerHasShort", "bannerHasRole", "botCommandsChannelId", "defaultSquadLimit" FROM "GuildSettings" WHERE "id" = ?',
        )
        .get('settings-1') as unknown as BannerSettingsRow;
      expect(settings).toEqual({
        bannerHasEmoji: 0,
        bannerHasName: 1,
        bannerHasShort: 1,
        bannerHasRole: 0,
        botCommandsChannelId: '200000000000000001',
        defaultSquadLimit: 23,
      });
    } finally {
      sqlite.close();
      rmSync(databasePath, { force: true });
      rmSync(`${databasePath}-journal`, { force: true });
    }
  });
});
