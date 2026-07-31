import { PrismaClient } from '@prisma/client';

export function createDatabaseClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({
    datasources: {
      db: { url: databaseUrl },
    },
  });
}
