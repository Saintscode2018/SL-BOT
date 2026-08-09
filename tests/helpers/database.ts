import { rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { PrismaClient, type BotPermission } from '@prisma/client';

import type { BotPermissionLevel } from '../../src/domain/enums.js';

export interface TestDatabase {
  client: PrismaClient;
  databasePath: string;
  databaseUrl: string;
}

export function applyMigrations(databaseUrl: string): void {
  const prismaCli = join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`migration failed\n${result.stdout}\n${result.stderr}`);
  }
}

export function createTestDatabase(): TestDatabase {
  const databaseFileName = `.test-${randomUUID()}.db`;
  const databasePath = join(process.cwd(), 'prisma', databaseFileName);
  const databaseUrl = `file:./${databaseFileName}`;
  // create the empty file before prisma migrate deploy on windows with prisma 6 19
  writeFileSync(databasePath, '', { flag: 'wx' });
  try {
    applyMigrations(databaseUrl);
  } catch (error: unknown) {
    rmSync(databasePath, { force: true });
    throw error;
  }
  process.env['DATABASE_URL'] = databaseUrl;
  return {
    client: new PrismaClient(),
    databasePath,
    databaseUrl,
  };
}

export async function clearDatabase(client: PrismaClient): Promise<void> {
  await client.moderationCase.deleteMany();
  await client.moderationCaseCounter.deleteMany();
  await client.moderationRole.deleteMany();
  await client.botPermission.deleteMany();
  await client.auditEvent.deleteMany();
  await client.leagueTransaction.deleteMany();
  await client.offer.deleteMany();
  await client.clubMembership.deleteMany();
  await client.guildSettings.deleteMany();
  await client.club.deleteMany();
  await client.leagueUser.deleteMany();
  await client.guild.deleteMany();
}

export async function grantBotPermission(
  client: PrismaClient,
  discordGuildId: string,
  discordUserId: string,
  level: BotPermissionLevel = 'BOTPERM',
): Promise<BotPermission> {
  const guild = await client.guild.findUniqueOrThrow({ where: { discordGuildId } });
  const user = await client.leagueUser.upsert({
    where: { discordUserId },
    create: { discordUserId },
    update: {},
  });
  return client.botPermission.upsert({
    where: { guildId_userId: { guildId: guild.id, userId: user.id } },
    create: {
      guildId: guild.id,
      userId: user.id,
      level,
      grantedByUserId: user.id,
    },
    update: { level, grantedByUserId: user.id },
  });
}

export async function destroyTestDatabase(database: TestDatabase): Promise<void> {
  await database.client.$disconnect();
  rmSync(database.databasePath, { force: true });
  rmSync(`${database.databasePath}-journal`, { force: true });
}
