-- CreateTable
CREATE TABLE "ModerationRole" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "discordRoleId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ModerationRole_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ModerationRole_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "LeagueUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ModerationRole_guildId_discordRoleId_key" ON "ModerationRole"("guildId", "discordRoleId");

-- CreateIndex
CREATE INDEX "ModerationRole_guildId_createdAt_idx" ON "ModerationRole"("guildId", "createdAt");
