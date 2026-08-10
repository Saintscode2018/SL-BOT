-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LeagueTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transactionType" TEXT NOT NULL,
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
    CONSTRAINT "LeagueTransaction_offerId_guildId_fkey" FOREIGN KEY ("offerId", "guildId") REFERENCES "Offer" ("id", "guildId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeagueTransaction_reversedByUserId_fkey" FOREIGN KEY ("reversedByUserId") REFERENCES "LeagueUser" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LeagueTransaction" ("createdAt", "destinationClubId", "guildId", "id", "offerId", "performedByUserId", "reason", "reversedAt", "reversedByUserId", "sourceClubId", "transactionType", "userId") SELECT "createdAt", "destinationClubId", "guildId", "id", "offerId", "performedByUserId", "reason", "reversedAt", "reversedByUserId", "sourceClubId", "transactionType", "userId" FROM "LeagueTransaction";
DROP TABLE "LeagueTransaction";
ALTER TABLE "new_LeagueTransaction" RENAME TO "LeagueTransaction";
CREATE INDEX "LeagueTransaction_guildId_createdAt_idx" ON "LeagueTransaction"("guildId", "createdAt");
CREATE INDEX "LeagueTransaction_userId_createdAt_idx" ON "LeagueTransaction"("userId", "createdAt");
CREATE INDEX "LeagueTransaction_sourceClubId_createdAt_idx" ON "LeagueTransaction"("sourceClubId", "createdAt");
CREATE INDEX "LeagueTransaction_destinationClubId_createdAt_idx" ON "LeagueTransaction"("destinationClubId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Offer_id_guildId_key" ON "Offer"("id", "guildId");
