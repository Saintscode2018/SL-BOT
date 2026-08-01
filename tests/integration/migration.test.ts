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

interface TableColumnRow {
  name: string;
  notnull: number;
}

interface PreservedSettingsRow {
  botCommandsChannelId: string;
  staffChannelId: string;
  transferChannelId: string;
  auditChannelId: string;
  botPermissionsRoleId: string;
  teamManagerRoleId: string;
  assistantManagerRoleId: string;
  playerManagerRoleId: string;
  defaultSquadLimit: number;
  offerTimeoutSeconds: number;
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

  it('creates the final team identity schema on a fresh database', () => {
    const sqlite = new DatabaseSync(database.databasePath, { readOnly: true });
    try {
      const clubColumns = sqlite
        .prepare('PRAGMA table_info("Club")')
        .all() as unknown as TableColumnRow[];
      const settingsColumns = sqlite
        .prepare('PRAGMA table_info("GuildSettings")')
        .all() as unknown as TableColumnRow[];

      expect(clubColumns.map(({ name }) => name)).not.toEqual(
        expect.arrayContaining(['name', 'shortName']),
      );
      expect(clubColumns.find(({ name }) => name === 'emoji')?.notnull).toBe(1);
      expect(settingsColumns.map(({ name }) => name)).not.toEqual(
        expect.arrayContaining([
          'bannerHasEmoji',
          'bannerHasName',
          'bannerHasShort',
          'bannerHasRole',
        ]),
      );
    } finally {
      sqlite.close();
    }
  });

  it('migrates populated Stage 4A data without losing relations or unrelated settings', () => {
    const databasePath = join(process.cwd(), 'prisma', `.stage4a-${randomUUID()}.db`);
    writeFileSync(databasePath, '', { flag: 'wx' });
    const sqlite = new DatabaseSync(databasePath);
    try {
      for (const migration of [
        '20260731130000_initial_foundation',
        '20260801000000_setup_channels_and_squad_limits',
        '20260801140000_rename_bot_permissions_role',
        '20260801190000_team_banner_configuration',
        '20260801210000_correct_team_banner_defaults',
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
          'INSERT INTO "GuildSettings" ("id", "guildId", "botCommandsChannelId", "staffChannelId", "transferChannelId", "auditChannelId", "botPermissionsRoleId", "teamManagerRoleId", "assistantManagerRoleId", "playerManagerRoleId", "defaultSquadLimit", "offerTimeoutSeconds", "bannerHasEmoji", "bannerHasName", "bannerHasShort", "bannerHasRole", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'settings-1',
          'guild-1',
          '200000000000000001',
          '200000000000000002',
          '200000000000000003',
          '200000000000000004',
          '300000000000000001',
          '300000000000000002',
          '300000000000000003',
          '300000000000000004',
          23,
          7200,
          0,
          1,
          1,
          0,
          new Date().toISOString(),
        );
      sqlite
        .prepare(
          'INSERT INTO "Club" ("id", "guildId", "name", "shortName", "discordRoleId", "logoUrl", "emoji", "squadLimitOverride", "active", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'club-1',
          'guild-1',
          'Legacy Name',
          'LEG',
          '400000000000000001',
          'https://example.com/legacy.png',
          '<:legacy:500000000000000001>',
          21,
          0,
          new Date().toISOString(),
        );
      sqlite
        .prepare(
          'INSERT INTO "LeagueUser" ("id", "discordUserId", "updatedAt") VALUES (?, ?, ?), (?, ?, ?)',
        )
        .run(
          'user-1',
          '600000000000000001',
          new Date().toISOString(),
          'user-2',
          '600000000000000002',
          new Date().toISOString(),
        );
      sqlite
        .prepare(
          'INSERT INTO "ClubMembership" ("id", "guildId", "clubId", "userId", "membershipType", "createdByUserId", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'membership-player',
          'guild-1',
          'club-1',
          'user-1',
          'PLAYER',
          'user-2',
          new Date().toISOString(),
          'membership-manager',
          'guild-1',
          'club-1',
          'user-2',
          'TEAM_MANAGER',
          'user-2',
          new Date().toISOString(),
        );
      sqlite
        .prepare(
          'INSERT INTO "Offer" ("id", "guildId", "clubId", "playerUserId", "offeredByUserId", "expiresAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'offer-1',
          'guild-1',
          'club-1',
          'user-1',
          'user-2',
          new Date(Date.now() + 86_400_000).toISOString(),
          new Date().toISOString(),
        );
      sqlite
        .prepare(
          'INSERT INTO "LeagueTransaction" ("id", "guildId", "userId", "transactionType", "destinationClubId", "performedByUserId", "offerId") VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('transaction-1', 'guild-1', 'user-1', 'SIGNING', 'club-1', 'user-2', 'offer-1');
      sqlite
        .prepare(
          'INSERT INTO "AuditEvent" ("id", "guildId", "actorUserId", "eventType", "entityType", "entityId") VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('audit-1', 'guild-1', 'user-2', 'legacy.event', 'club', 'club-1');

      sqlite.exec(
        readFileSync(
          join(
            process.cwd(),
            'prisma',
            'migrations',
            '20260801230000_final_team_identity',
            'migration.sql',
          ),
          { encoding: 'utf8' },
        ),
      );

      const settings = sqlite
        .prepare(
          'SELECT "botCommandsChannelId", "staffChannelId", "transferChannelId", "auditChannelId", "botPermissionsRoleId", "teamManagerRoleId", "assistantManagerRoleId", "playerManagerRoleId", "defaultSquadLimit", "offerTimeoutSeconds" FROM "GuildSettings" WHERE "id" = ?',
        )
        .get('settings-1') as unknown as PreservedSettingsRow;
      expect(settings).toEqual({
        botCommandsChannelId: '200000000000000001',
        staffChannelId: '200000000000000002',
        transferChannelId: '200000000000000003',
        auditChannelId: '200000000000000004',
        botPermissionsRoleId: '300000000000000001',
        teamManagerRoleId: '300000000000000002',
        assistantManagerRoleId: '300000000000000003',
        playerManagerRoleId: '300000000000000004',
        defaultSquadLimit: 23,
        offerTimeoutSeconds: 7200,
      });

      const clubColumns = sqlite
        .prepare('PRAGMA table_info("Club")')
        .all() as unknown as TableColumnRow[];
      const settingsColumns = sqlite
        .prepare('PRAGMA table_info("GuildSettings")')
        .all() as unknown as TableColumnRow[];
      expect(clubColumns.map(({ name }) => name)).not.toEqual(
        expect.arrayContaining(['name', 'shortName']),
      );
      expect(settingsColumns.map(({ name }) => name)).not.toEqual(
        expect.arrayContaining([
          'bannerHasEmoji',
          'bannerHasName',
          'bannerHasShort',
          'bannerHasRole',
        ]),
      );

      expect(
        sqlite
          .prepare(
            'SELECT "id", "guildId", "discordRoleId", "logoUrl", "emoji", "squadLimitOverride", "active" FROM "Club" WHERE "id" = ?',
          )
          .get('club-1'),
      ).toEqual({
        id: 'club-1',
        guildId: 'guild-1',
        discordRoleId: '400000000000000001',
        logoUrl: 'https://example.com/legacy.png',
        emoji: '<:legacy:500000000000000001>',
        squadLimitOverride: 21,
        active: 0,
      });
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM "ClubMembership"').get()).toEqual({
        count: 2,
      });
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM "Offer"').get()).toEqual({ count: 1 });
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM "LeagueTransaction"').get()).toEqual({
        count: 1,
      });
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM "AuditEvent"').get()).toEqual({
        count: 1,
      });
      expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

      const clubIndexes = sqlite
        .prepare('SELECT "name" FROM "sqlite_master" WHERE "type" = ? AND "tbl_name" = ?')
        .all('index', 'Club') as unknown as NameRow[];
      expect(clubIndexes.map(({ name }) => name)).toEqual(
        expect.arrayContaining([
          'Club_guildId_discordRoleId_key',
          'Club_id_guildId_key',
          'Club_guildId_active_idx',
        ]),
      );
      expect(clubIndexes.map(({ name }) => name).join(' ')).not.toMatch(/name|short/i);
      expect(() =>
        sqlite
          .prepare(
            'INSERT INTO "Club" ("id", "guildId", "discordRoleId", "emoji", "updatedAt") VALUES (?, ?, ?, ?, ?)',
          )
          .run('club-duplicate', 'guild-1', '400000000000000001', '🔵', new Date().toISOString()),
      ).toThrow();
    } finally {
      sqlite.close();
      rmSync(databasePath, { force: true });
      rmSync(`${databasePath}-journal`, { force: true });
    }
  });
});
