"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.command = void 0;
exports.isManagerInGuild = isManagerInGuild;
exports.getConfiguredManagerRole = getConfiguredManagerRole;
exports.assignManagerRoles = assignManagerRoles;
exports.syncManagerMemberRoles = syncManagerMemberRoles;
exports.removeManagerRoleIfUnused = removeManagerRoleIfUnused;
exports.removeFormerManagerRoles = removeFormerManagerRoles;
exports.syncAllManagerRoles = syncAllManagerRoles;
const discord_js_1 = require("discord.js");
const database_js_1 = require("./database.js");
const embeds_js_1 = require("./embeds.js");
const permissions_js_1 = require("./permissions.js");
function getManagedTeamRoles(data, guild, userId) {
    return Object.entries(data.teams)
        .filter(([, team]) => team.managerid === userId)
        .map(([roleId]) => guild.roles.cache.get(roleId))
        .filter((role) => Boolean(role));
}
function isManagerInGuild(data, guild, userId) {
    return getManagedTeamRoles(data, guild, userId).length > 0;
}
function getConfiguredManagerRole(data, guild) {
    const roleId = data.settings.managerRoles[guild.id];
    return roleId ? guild.roles.cache.get(roleId) ?? null : null;
}
function ensureRoleCanBeAssigned(role, label) {
    if (!role.editable) {
        throw new Error(`I cannot assign the ${label}. Place my bot role above ${role} and make sure I have Manage Roles.`);
    }
}
async function assignManagerRoles(member, teamRole, data, reason) {
    const managerRole = getConfiguredManagerRole(data, member.guild);
    if (!managerRole) {
        throw new Error("Set a manager role first with `/managerrole`.");
    }
    if (!member.manageable) {
        throw new Error(`I cannot manage ${member}. Place my bot role above their highest role and try again.`);
    }
    ensureRoleCanBeAssigned(managerRole, "configured manager role");
    ensureRoleCanBeAssigned(teamRole, "team role");
    const missingRoles = [managerRole, teamRole].filter(role => !member.roles.cache.has(role.id));
    if (missingRoles.length) {
        await member.roles.add(missingRoles, reason);
    }
}
async function syncManagerMemberRoles(member, data, reason) {
    const teamRoles = getManagedTeamRoles(data, member.guild, member.id);
    if (!teamRoles.length)
        return 0;
    const managerRole = getConfiguredManagerRole(data, member.guild);
    if (!managerRole)
        return 0;
    if (!member.manageable) {
        throw new Error(`Cannot manage ${member.user.tag}.`);
    }
    ensureRoleCanBeAssigned(managerRole, "configured manager role");
    for (const teamRole of teamRoles) {
        ensureRoleCanBeAssigned(teamRole, "team role");
    }
    const missingRoles = [managerRole, ...teamRoles].filter(role => !member.roles.cache.has(role.id));
    if (missingRoles.length) {
        await member.roles.add(missingRoles, reason);
    }
    return missingRoles.length;
}
async function removeManagerRoleIfUnused(guild, userId, data, reason) {
    if (isManagerInGuild(data, guild, userId))
        return true;
    const managerRole = getConfiguredManagerRole(data, guild);
    if (!managerRole)
        return true;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member || !member.roles.cache.has(managerRole.id))
        return true;
    if (!member.manageable || !managerRole.editable)
        return false;
    return member.roles.remove(managerRole, reason).then(() => true, error => {
        console.error(error);
        return false;
    });
}
async function removeFormerManagerRoles(guild, userId, teamRole, data, reason) {
    const managerRoleRemoved = await removeManagerRoleIfUnused(guild, userId, data, reason);
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member || !member.roles.cache.has(teamRole.id)) {
        return managerRoleRemoved;
    }
    if (!member.manageable || !teamRole.editable) {
        return false;
    }
    const teamRoleRemoved = await member.roles.remove(teamRole, reason).then(() => true, error => {
        console.error(error);
        return false;
    });
    return managerRoleRemoved && teamRoleRemoved;
}
async function syncAllManagerRoles(client) {
    const data = (0, database_js_1.loadData)();
    for (const guild of client.guilds.cache.values()) {
        if (!getConfiguredManagerRole(data, guild))
            continue;
        const managerIds = new Set(Object.entries(data.teams)
            .filter(([roleId]) => guild.roles.cache.has(roleId))
            .map(([, team]) => team.managerid)
            .filter(Boolean));
        for (const managerId of managerIds) {
            const member = await guild.members.fetch(managerId).catch(() => null);
            if (!member)
                continue;
            await syncManagerMemberRoles(member, data, "Restoring configured manager and team roles").catch(console.error);
        }
    }
}
exports.command = {
    data: new discord_js_1.SlashCommandBuilder()
        .setName("managerrole")
        .setDescription("Set the Discord role automatically assigned to team managers.")
        .addRoleOption(option => option
        .setName("role")
        .setDescription("The shared manager role.")
        .setRequired(true)),
    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("This command can only be used inside a server.")],
                ephemeral: true
            });
            return;
        }
        const data = (0, database_js_1.loadData)();
        if (!(0, permissions_js_1.canRunLeagueAdmin)(interaction, data)) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("You do not have permission to configure the manager role.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        const selectedRole = interaction.options.getRole("role", true);
        const managerRole = interaction.guild.roles.cache.get(selectedRole.id);
        if (!managerRole || managerRole.id === interaction.guild.id) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("Choose a normal Discord role instead of @everyone.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        if (data.teams[managerRole.id]) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("A registered team role cannot also be the shared manager role.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        if (data.settings.assistantManagerRoles[interaction.guild.id] === managerRole.id) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("The manager and assistant manager roles must be different.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        if (!managerRole.editable) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)(`I cannot assign ${managerRole}. Place my bot role above it and grant Manage Roles.`, interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        await interaction.deferReply({ ephemeral: true });
        const previousRoleId = data.settings.managerRoles[interaction.guild.id];
        const previousRole = previousRoleId
            ? interaction.guild.roles.cache.get(previousRoleId)
            : null;
        data.settings.managerRoles[interaction.guild.id] = managerRole.id;
        (0, database_js_1.saveData)(data);
        const managerIds = new Set(Object.entries(data.teams)
            .filter(([roleId]) => interaction.guild?.roles.cache.has(roleId))
            .map(([, team]) => team.managerid)
            .filter(Boolean));
        let synced = 0;
        let failed = 0;
        for (const managerId of managerIds) {
            const member = await interaction.guild.members.fetch(managerId).catch(() => null);
            if (!member) {
                failed += 1;
                continue;
            }
            try {
                await syncManagerMemberRoles(member, data, `Manager role configured by ${interaction.user.tag}`);
                if (previousRole &&
                    previousRole.id !== managerRole.id &&
                    member.roles.cache.has(previousRole.id)) {
                    await member.roles.remove(previousRole, `Manager role changed by ${interaction.user.tag}`);
                }
                synced += 1;
            }
            catch (error) {
                console.error(error);
                failed += 1;
            }
        }
        const embed = failed
            ? (0, embeds_js_1.createStatusEmbed)({
                guild: interaction.guild,
                title: "Manager Role Saved with Warnings",
                description: `${managerRole} is now the shared manager role. Some existing managers could not be updated.`,
                color: 0xfee75c,
                fields: [
                    { name: "Managers Updated", value: String(synced), inline: true },
                    { name: "Needs Attention", value: String(failed), inline: true }
                ]
            })
            : (0, embeds_js_1.createSuccessEmbed)(interaction.guild, "Manager Role Set", `${managerRole} is now the shared manager role.`, [{ name: "Managers Updated", value: String(synced), inline: true }]);
        await interaction.editReply({ embeds: [embed] });
    }
};
