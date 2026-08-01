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
    "bannerHasEmoji" BOOLEAN NOT NULL DEFAULT true,
    "bannerHasName" BOOLEAN NOT NULL DEFAULT false,
    "bannerHasShort" BOOLEAN NOT NULL DEFAULT false,
    "bannerHasRole" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "GuildSettings_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_GuildSettings" ("id", "guildId", "transferChannelId", "auditChannelId", "botPermissionsRoleId", "teamManagerRoleId", "assistantManagerRoleId", "playerManagerRoleId", "offerTimeoutSeconds", "createdAt", "updatedAt", "botCommandsChannelId", "staffChannelId", "defaultSquadLimit", "bannerHasEmoji", "bannerHasName", "bannerHasShort", "bannerHasRole")
SELECT "id", "guildId", "transferChannelId", "auditChannelId", "botPermissionsRoleId", "teamManagerRoleId", "assistantManagerRoleId", "playerManagerRoleId", "offerTimeoutSeconds", "createdAt", "updatedAt", "botCommandsChannelId", "staffChannelId", "defaultSquadLimit", "bannerHasEmoji", "bannerHasName", "bannerHasShort", "bannerHasRole" FROM "GuildSettings";

DROP TABLE "GuildSettings";
ALTER TABLE "new_GuildSettings" RENAME TO "GuildSettings";
CREATE UNIQUE INDEX "GuildSettings_guildId_key" ON "GuildSettings"("guildId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
