import {
    ChatInputCommandInteraction,
    PermissionFlagsBits
} from "discord.js";

import type { Database } from "./database.js";

export type AccessScope = "echo" | "league_admin";

export function isOwner(data: Database, userId: string): boolean {
    return data.settings.owner_id === userId;
}

export function hasAccess(
    data: Database,
    userId: string,
    scope: AccessScope
): boolean {
    return isOwner(data, userId) || data.settings.whitelists[scope].includes(userId);
}

export function canRunLeagueAdmin(
    interaction: ChatInputCommandInteraction,
    data: Database
): boolean {
    return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) === true ||
        hasAccess(data, interaction.user.id, "league_admin");
}
