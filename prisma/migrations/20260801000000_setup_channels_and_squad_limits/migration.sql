PRAGMA foreign_keys=OFF;

-- Alter GuildSettings table to add botCommandsChannelId, staffChannelId, defaultSquadLimit
ALTER TABLE "GuildSettings" ADD COLUMN "botCommandsChannelId" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "staffChannelId" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "defaultSquadLimit" INTEGER NOT NULL DEFAULT 17 CHECK ("defaultSquadLimit" > 0);

-- Redefine Club table to replace squadLimit with squadLimitOverride
CREATE TABLE "new_Club" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "discordRoleId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "emoji" TEXT,
    "squadLimitOverride" INTEGER CHECK ("squadLimitOverride" IS NULL OR "squadLimitOverride" > 0),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Club_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_Club" ("id", "guildId", "name", "shortName", "discordRoleId", "logoUrl", "emoji", "squadLimitOverride", "active", "createdAt", "updatedAt")
SELECT "id", "guildId", "name", "shortName", "discordRoleId", "logoUrl", "emoji", 
  CASE WHEN "squadLimit" = 17 THEN NULL ELSE "squadLimit" END,
  "active", "createdAt", "updatedAt"
FROM "Club";

DROP TABLE "Club";
ALTER TABLE "new_Club" RENAME TO "Club";

CREATE UNIQUE INDEX "Club_guildId_name_key" ON "Club"("guildId", "name");
CREATE UNIQUE INDEX "Club_guildId_shortName_key" ON "Club"("guildId", "shortName");
CREATE UNIQUE INDEX "Club_guildId_discordRoleId_key" ON "Club"("guildId", "discordRoleId");
CREATE UNIQUE INDEX "Club_id_guildId_key" ON "Club"("id", "guildId");
CREATE INDEX "Club_guildId_active_idx" ON "Club"("guildId", "active");

PRAGMA foreign_keys=ON;
