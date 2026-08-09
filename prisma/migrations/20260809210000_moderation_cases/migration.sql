-- CreateTable
CREATE TABLE "ModerationCaseCounter" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "nextCaseNumber" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "ModerationCaseCounter_next_case_number_check" CHECK ("nextCaseNumber" > 0),
    CONSTRAINT "ModerationCaseCounter_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModerationCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "caseNumber" INTEGER NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "issuedByUserId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT,
    "bail" INTEGER NOT NULL,
    "durationSeconds" INTEGER,
    "expiresAt" DATETIME,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "resolutionType" TEXT,
    "resolvedByUserId" TEXT,
    "resolutionReason" TEXT,
    "resolvedAt" DATETIME,
    CONSTRAINT "ModerationCase_type_check" CHECK ("type" IN ('MUTE', 'BAN', 'BLACKLIST')),
    CONSTRAINT "ModerationCase_status_check" CHECK ("status" IN ('ACTIVE', 'RESOLVED')),
    CONSTRAINT "ModerationCase_resolution_type_check" CHECK ("resolutionType" IS NULL OR "resolutionType" IN ('MANUAL', 'EXPIRED')),
    CONSTRAINT "ModerationCase_case_number_check" CHECK ("caseNumber" > 0),
    CONSTRAINT "ModerationCase_bail_check" CHECK ("bail" >= 0),
    CONSTRAINT "ModerationCase_reason_length_check" CHECK ("reason" IS NULL OR length("reason") <= 1000),
    CONSTRAINT "ModerationCase_resolution_reason_length_check" CHECK ("resolutionReason" IS NULL OR length("resolutionReason") <= 1000),
    CONSTRAINT "ModerationCase_duration_check" CHECK (
        ("type" = 'MUTE' AND "durationSeconds" IS NOT NULL AND "durationSeconds" > 0 AND "expiresAt" IS NOT NULL AND "expiresAt" > "issuedAt") OR
        ("type" IN ('BAN', 'BLACKLIST') AND "durationSeconds" IS NULL AND "expiresAt" IS NULL)
    ),
    CONSTRAINT "ModerationCase_resolution_check" CHECK (
        ("status" = 'ACTIVE' AND "resolutionType" IS NULL AND "resolvedByUserId" IS NULL AND "resolutionReason" IS NULL AND "resolvedAt" IS NULL) OR
        ("status" = 'RESOLVED' AND "resolutionType" = 'MANUAL' AND "resolvedByUserId" IS NOT NULL AND "resolvedAt" IS NOT NULL AND "resolvedAt" >= "issuedAt") OR
        ("status" = 'RESOLVED' AND "resolutionType" = 'EXPIRED' AND "type" = 'MUTE' AND "resolvedByUserId" IS NULL AND "resolutionReason" IS NULL AND "resolvedAt" IS NOT NULL AND "resolvedAt" >= "expiresAt")
    ),
    CONSTRAINT "ModerationCase_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ModerationCase_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "LeagueUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ModerationCase_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "LeagueUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ModerationCase_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "LeagueUser" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ModerationCase_guildId_caseNumber_key" ON "ModerationCase"("guildId", "caseNumber");

-- CreateIndex
CREATE INDEX "ModerationCase_guildId_targetUserId_caseNumber_idx" ON "ModerationCase"("guildId", "targetUserId", "caseNumber");

-- CreateIndex
CREATE INDEX "ModerationCase_guildId_targetUserId_type_status_idx" ON "ModerationCase"("guildId", "targetUserId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ModerationCase_one_active_type_per_target" ON "ModerationCase"("guildId", "targetUserId", "type")
WHERE "status" = 'ACTIVE';
