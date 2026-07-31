PRAGMA foreign_keys=OFF;

CREATE TABLE "Guild" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discordGuildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "GuildSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "transferChannelId" TEXT,
    "auditChannelId" TEXT,
    "adminRoleId" TEXT,
    "teamManagerRoleId" TEXT,
    "assistantManagerRoleId" TEXT,
    "playerManagerRoleId" TEXT,
    "offerTimeoutSeconds" INTEGER NOT NULL DEFAULT 86400 CHECK ("offerTimeoutSeconds" > 0),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GuildSettings_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Club" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "discordRoleId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "emoji" TEXT,
    "squadLimit" INTEGER NOT NULL CHECK ("squadLimit" > 0),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Club_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "LeagueUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discordUserId" TEXT NOT NULL,
    "robloxUserId" TEXT,
    "robloxUsername" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "ClubMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipType" TEXT NOT NULL CHECK ("membershipType" IN ('PLAYER', 'TEAM_MANAGER', 'ASSISTANT_MANAGER', 'PLAYER_MANAGER')),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE', 'ENDED')),
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" DATETIME,
    "createdByUserId" TEXT,
    "endedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClubMembership_status_timestamps_check" CHECK (
        ("status" = 'ACTIVE' AND "leftAt" IS NULL) OR
        ("status" = 'ENDED' AND "leftAt" IS NOT NULL)
    ),
    CONSTRAINT "ClubMembership_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClubMembership_clubId_guildId_fkey" FOREIGN KEY ("clubId", "guildId") REFERENCES "Club" ("id", "guildId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClubMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "LeagueUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClubMembership_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "LeagueUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ClubMembership_endedByUserId_fkey" FOREIGN KEY ("endedByUserId") REFERENCES "LeagueUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Offer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "playerUserId" TEXT NOT NULL,
    "offeredByUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'VOIDED')),
    "discordChannelId" TEXT,
    "discordMessageId" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" DATETIME,
    "cancelledAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Offer_expiry_check" CHECK ("expiresAt" > "createdAt"),
    CONSTRAINT "Offer_status_timestamps_check" CHECK (
        ("status" = 'PENDING' AND "respondedAt" IS NULL AND "cancelledAt" IS NULL) OR
        ("status" = 'CANCELLED' AND "respondedAt" IS NOT NULL AND "cancelledAt" IS NOT NULL) OR
        ("status" IN ('ACCEPTED', 'DECLINED', 'EXPIRED', 'VOIDED') AND "respondedAt" IS NOT NULL AND "cancelledAt" IS NULL)
    ),
    CONSTRAINT "Offer_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Offer_clubId_guildId_fkey" FOREIGN KEY ("clubId", "guildId") REFERENCES "Club" ("id", "guildId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Offer_playerUserId_fkey" FOREIGN KEY ("playerUserId") REFERENCES "LeagueUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Offer_offeredByUserId_fkey" FOREIGN KEY ("offeredByUserId") REFERENCES "LeagueUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "LeagueTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transactionType" TEXT NOT NULL CHECK ("transactionType" IN ('SIGNING', 'TRANSFER', 'RELEASE', 'DEMAND_RELEASE', 'STAFF_APPOINTMENT', 'STAFF_PROMOTION', 'STAFF_DEMOTION', 'TEAM_SWAP')),
    "sourceClubId" TEXT,
    "destinationClubId" TEXT,
    "performedByUserId" TEXT NOT NULL,
    "offerId" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" DATETIME,
    "reversedByUserId" TEXT,
    CONSTRAINT "LeagueTransaction_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeagueTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "LeagueUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeagueTransaction_sourceClubId_guildId_fkey" FOREIGN KEY ("sourceClubId", "guildId") REFERENCES "Club" ("id", "guildId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeagueTransaction_destinationClubId_guildId_fkey" FOREIGN KEY ("destinationClubId", "guildId") REFERENCES "Club" ("id", "guildId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeagueTransaction_performedByUserId_fkey" FOREIGN KEY ("performedByUserId") REFERENCES "LeagueUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeagueTransaction_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LeagueTransaction_reversedByUserId_fkey" FOREIGN KEY ("reversedByUserId") REFERENCES "LeagueUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "eventType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "beforeState" JSONB,
    "afterState" JSONB,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "LeagueUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Guild_discordGuildId_key" ON "Guild"("discordGuildId");
CREATE UNIQUE INDEX "GuildSettings_guildId_key" ON "GuildSettings"("guildId");
CREATE UNIQUE INDEX "Club_guildId_name_key" ON "Club"("guildId", "name");
CREATE UNIQUE INDEX "Club_guildId_shortName_key" ON "Club"("guildId", "shortName");
CREATE UNIQUE INDEX "Club_guildId_discordRoleId_key" ON "Club"("guildId", "discordRoleId");
CREATE UNIQUE INDEX "Club_id_guildId_key" ON "Club"("id", "guildId");
CREATE INDEX "Club_guildId_active_idx" ON "Club"("guildId", "active");
CREATE UNIQUE INDEX "LeagueUser_discordUserId_key" ON "LeagueUser"("discordUserId");
CREATE INDEX "ClubMembership_guildId_userId_status_idx" ON "ClubMembership"("guildId", "userId", "status");
CREATE INDEX "ClubMembership_clubId_membershipType_status_idx" ON "ClubMembership"("clubId", "membershipType", "status");
CREATE INDEX "Offer_guildId_playerUserId_status_idx" ON "Offer"("guildId", "playerUserId", "status");
CREATE INDEX "Offer_clubId_status_idx" ON "Offer"("clubId", "status");
CREATE INDEX "Offer_status_expiresAt_idx" ON "Offer"("status", "expiresAt");
CREATE INDEX "LeagueTransaction_guildId_createdAt_idx" ON "LeagueTransaction"("guildId", "createdAt");
CREATE INDEX "LeagueTransaction_userId_createdAt_idx" ON "LeagueTransaction"("userId", "createdAt");
CREATE INDEX "LeagueTransaction_sourceClubId_createdAt_idx" ON "LeagueTransaction"("sourceClubId", "createdAt");
CREATE INDEX "LeagueTransaction_destinationClubId_createdAt_idx" ON "LeagueTransaction"("destinationClubId", "createdAt");
CREATE INDEX "AuditEvent_guildId_createdAt_idx" ON "AuditEvent"("guildId", "createdAt");
CREATE INDEX "AuditEvent_entityType_entityId_createdAt_idx" ON "AuditEvent"("entityType", "entityId", "createdAt");
CREATE INDEX "AuditEvent_actorUserId_createdAt_idx" ON "AuditEvent"("actorUserId", "createdAt");

-- enforce active membership cardinality
CREATE UNIQUE INDEX "ClubMembership_one_active_player_per_guild"
ON "ClubMembership"("guildId", "userId")
WHERE "membershipType" = 'PLAYER' AND "status" = 'ACTIVE';

CREATE UNIQUE INDEX "ClubMembership_one_active_team_manager_per_club"
ON "ClubMembership"("clubId")
WHERE "membershipType" = 'TEAM_MANAGER' AND "status" = 'ACTIVE';

CREATE UNIQUE INDEX "ClubMembership_one_active_assistant_manager_per_club"
ON "ClubMembership"("clubId")
WHERE "membershipType" = 'ASSISTANT_MANAGER' AND "status" = 'ACTIVE';

CREATE UNIQUE INDEX "ClubMembership_one_active_player_manager_per_club"
ON "ClubMembership"("clubId")
WHERE "membershipType" = 'PLAYER_MANAGER' AND "status" = 'ACTIVE';

-- enforce one outstanding offer for a club and player
CREATE UNIQUE INDEX "Offer_one_pending_per_club_player"
ON "Offer"("clubId", "playerUserId")
WHERE "status" = 'PENDING';

PRAGMA foreign_keys=ON;
