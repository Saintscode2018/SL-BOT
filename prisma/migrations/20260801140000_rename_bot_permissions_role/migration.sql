-- Redefine GuildSettings table to rename adminRoleId to botPermissionsRoleId safely
PRAGMA foreign_keys=OFF;

ALTER TABLE "GuildSettings" RENAME COLUMN "adminRoleId" TO "botPermissionsRoleId";

PRAGMA foreign_keys=ON;
