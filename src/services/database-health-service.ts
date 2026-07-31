import type { PrismaClient } from '@prisma/client';

export class DatabaseHealthService {
  public constructor(private readonly database: PrismaClient) {}

  public async check(): Promise<boolean> {
    await this.database.$queryRaw`SELECT 1`;
    return true;
  }
}
