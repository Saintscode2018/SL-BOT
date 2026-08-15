"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isOwner = isOwner;
exports.hasAccess = hasAccess;
exports.canRunLeagueAdmin = canRunLeagueAdmin;
const discord_js_1 = require("discord.js");
function isOwner(data, userId) {
    return data.settings.owner_id === userId;
}
function hasAccess(data, userId, scope) {
    return isOwner(data, userId) || data.settings.whitelists[scope].includes(userId);
}
function canRunLeagueAdmin(interaction, data) {
    return interaction.memberPermissions?.has(discord_js_1.PermissionFlagsBits.ManageGuild) === true ||
        hasAccess(data, interaction.user.id, "league_admin");
}
