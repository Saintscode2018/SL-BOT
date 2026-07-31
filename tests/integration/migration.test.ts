import { DatabaseSync } from 'node:sqlite';

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
});
