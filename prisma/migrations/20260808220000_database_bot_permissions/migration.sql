-- CreateTable
CREATE TABLE "BotPermission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "level" TEXT NOT NULL CHECK ("level" IN ('BOTPERM', 'BOTPERM_ADMIN')),
    "grantedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BotPermission_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BotPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "LeagueUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BotPermission_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "LeagueUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BotPermission_guildId_userId_key" ON "BotPermission"("guildId", "userId");

-- CreateIndex
CREATE INDEX "BotPermission_guildId_level_idx" ON "BotPermission"("guildId", "level");
