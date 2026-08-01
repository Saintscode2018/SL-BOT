PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_GuildSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "transferChannelId" TEXT,
    "auditChannelId" TEXT,
    "botPermissionsRoleId" TEXT,
    "teamManagerRoleId" TEXT,
    "assistantManagerRoleId" TEXT,
    "playerManagerRoleId" TEXT,
    "offerTimeoutSeconds" INTEGER NOT NULL DEFAULT 86400 CHECK ("offerTimeoutSeconds" > 0),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "botCommandsChannelId" TEXT,
    "staffChannelId" TEXT,
    "defaultSquadLimit" INTEGER NOT NULL DEFAULT 17 CHECK ("defaultSquadLimit" > 0),
    CONSTRAINT "GuildSettings_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_GuildSettings" (
    "id",
    "guildId",
    "transferChannelId",
    "auditChannelId",
    "botPermissionsRoleId",
    "teamManagerRoleId",
    "assistantManagerRoleId",
    "playerManagerRoleId",
    "offerTimeoutSeconds",
    "createdAt",
    "updatedAt",
    "botCommandsChannelId",
    "staffChannelId",
    "defaultSquadLimit"
)
SELECT
    "id",
    "guildId",
    "transferChannelId",
    "auditChannelId",
    "botPermissionsRoleId",
    "teamManagerRoleId",
    "assistantManagerRoleId",
    "playerManagerRoleId",
    "offerTimeoutSeconds",
    "createdAt",
    "updatedAt",
    "botCommandsChannelId",
    "staffChannelId",
    "defaultSquadLimit"
FROM "GuildSettings";

DROP TABLE "GuildSettings";
ALTER TABLE "new_GuildSettings" RENAME TO "GuildSettings";
CREATE UNIQUE INDEX "GuildSettings_guildId_key" ON "GuildSettings"("guildId");

CREATE TABLE "new_Club" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "discordRoleId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "emoji" TEXT NOT NULL,
    "squadLimitOverride" INTEGER CHECK ("squadLimitOverride" IS NULL OR "squadLimitOverride" > 0),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Club_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_Club" (
    "id",
    "guildId",
    "discordRoleId",
    "logoUrl",
    "emoji",
    "squadLimitOverride",
    "active",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "guildId",
    "discordRoleId",
    "logoUrl",
    "emoji",
    "squadLimitOverride",
    "active",
    "createdAt",
    "updatedAt"
FROM "Club";

DROP TABLE "Club";
ALTER TABLE "new_Club" RENAME TO "Club";
CREATE UNIQUE INDEX "Club_guildId_discordRoleId_key" ON "Club"("guildId", "discordRoleId");
CREATE UNIQUE INDEX "Club_id_guildId_key" ON "Club"("id", "guildId");
CREATE INDEX "Club_guildId_active_idx" ON "Club"("guildId", "active");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
