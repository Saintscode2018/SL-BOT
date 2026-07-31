import { PrismaClient } from '@prisma/client';

const globalDatabase = globalThis as typeof globalThis & {
  slBotPrisma?: PrismaClient;
};

export const prisma = globalDatabase.slBotPrisma ?? new PrismaClient();

if (process.env['NODE_ENV'] !== 'production') {
  globalDatabase.slBotPrisma = prisma;
}

export async function shutdownDatabase(): Promise<void> {
  await prisma.$disconnect();
}
