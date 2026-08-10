-- Historical clubs retain their Discord role ID for auditability, while only
-- active clubs reserve it for a future team. SQLite supports this invariant as
-- a partial unique index, which Prisma's SQLite schema syntax cannot model.
DROP INDEX "Club_guildId_discordRoleId_key";
CREATE INDEX "Club_guildId_discordRoleId_idx" ON "Club"("guildId", "discordRoleId");
CREATE UNIQUE INDEX "Club_active_guild_discord_role_key"
ON "Club"("guildId", "discordRoleId")
WHERE "active" = 1;
