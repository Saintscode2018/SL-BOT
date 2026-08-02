-- Stage 4B.1 protects the league-wide active staff uniqueness invariant at the database boundary.
CREATE UNIQUE INDEX "ClubMembership_one_active_staff_per_guild_user"
ON "ClubMembership"("guildId", "userId")
WHERE "membershipType" IN ('TEAM_MANAGER', 'ASSISTANT_MANAGER', 'PLAYER_MANAGER')
  AND "status" = 'ACTIVE';
