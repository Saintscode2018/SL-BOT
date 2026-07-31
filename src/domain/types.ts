import type { Prisma, PrismaClient } from '@prisma/client';

export type DatabaseClient = PrismaClient | Prisma.TransactionClient;

export type JsonInput = Prisma.InputJsonValue;
