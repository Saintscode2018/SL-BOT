"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.demandResetCommand = exports.demandLimitCommand = exports.command = void 0;
exports.canUseDemand = canUseDemand;
exports.getDemandUsage = getDemandUsage;
const discord_js_1 = require("discord.js");
const database_js_1 = require("./database.js");
const embeds_js_1 = require("./embeds.js");
const permissions_js_1 = require("./permissions.js");
const teamstaff_js_1 = require("./teamstaff.js");
const teamembeds_js_1 = require("./teamembeds.js");
function canUseDemand(authority) {
    return authority === null;
}
function getDemandUsage(data, guildId, userId) {
    return data.settings.demandUsage[guildId]?.[userId] ?? 0;
}
exports.command = {
    data: new discord_js_1.SlashCommandBuilder()
        .setName("demand")
        .setDescription("Leave your current team."),
    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("This command can only be used inside a server.")],
                ephemeral: true
            });
            return;
        }
        const data = (0, database_js_1.loadData)();
        const leadership = (0, teamstaff_js_1.findTeamAccess)(data, interaction.user.id);
        if (!canUseDemand(leadership?.authority ?? null)) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("Managers and team staff cannot use this command.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        const member = await interaction.guild.members
            .fetch(interaction.user.id)
            .catch(() => null);
        if (!member) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("Your server member could not be found.", interaction.guild)],
                ephemeral: true
            });
            return;
        }
        const teamIds = Object.keys(data.teams).filter(roleId => member.roles.cache.has(roleId));
        if (!teamIds.length) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("You are not currently on a registered team.", interaction.guild)],
                ephemeral: true
            });
            return;
        }
        if (teamIds.length > 1) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("You have more than one team role. Ask a league administrator to correct your roles.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        const teamRole = interaction.guild.roles.cache.get(teamIds[0]);
        const team = data.teams[teamIds[0]];
        if (!teamRole || !team) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("Your team role could not be found.", interaction.guild)],
                ephemeral: true
            });
            return;
        }
        const demandLimit = (0, database_js_1.getDemandLimit)(data, interaction.guild.id);
        const used = getDemandUsage(data, interaction.guild.id, interaction.user.id);
        if (used >= demandLimit) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)(`You have used all ${demandLimit} of your available team demands.`, interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        const botMember = interaction.guild.members.me;
        if (!botMember?.permissions.has(discord_js_1.PermissionFlagsBits.ManageRoles) ||
            !member.manageable ||
            !teamRole.editable) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("I cannot remove the required roles. Check my Manage Roles permission and role position.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        data.settings.demandUsage[interaction.guild.id] ??= {};
        data.settings.demandUsage[interaction.guild.id][interaction.user.id] = used + 1;
        try {
            (0, database_js_1.saveData)(data);
        }
        catch (error) {
            console.error(error);
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("I could not save the departure. No roles were changed.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        try {
            await member.roles.remove(teamRole, "Player left the team using /demand");
        }
        catch (error) {
            console.error(error);
            if (used) {
                data.settings.demandUsage[interaction.guild.id][interaction.user.id] = used;
            }
            else {
                delete data.settings.demandUsage[interaction.guild.id][interaction.user.id];
            }
            const restored = (() => {
                try {
                    (0, database_js_1.saveData)(data);
                    return true;
                }
                catch (restoreError) {
                    console.error(restoreError);
                    return false;
                }
            })();
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)(restored
                        ? `I could not remove the required roles from ${member}. No demand was used.`
                        : "I could not remove the required roles, and the saved demand record needs an administrator to correct it.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        const embed = (0, teamembeds_js_1.createTeamTransactionEmbed)({
            guild: interaction.guild,
            teamRole,
            team,
            data,
            title: `Player Departure - ${teamRole.name}`,
            description: `> ${member} has left ${(0, teamembeds_js_1.getTeamEmoji)(teamRole)} ${teamRole}.`,
            color: 0xed4245,
            extraFields: [
                {
                    name: "📄 Demands Used",
                    value: `\`${used + 1}/${demandLimit}\``,
                    inline: true
                }
            ]
        });
        await interaction.reply({ embeds: [embed], ephemeral: true });
        await (0, teamembeds_js_1.sendTransactionRecord)(interaction.guild, data, embed);
    }
};
exports.demandLimitCommand = {
    data: new discord_js_1.SlashCommandBuilder()
        .setName("demandlimit")
        .setDescription("Set how many times each member can leave a team.")
        .addIntegerOption(option => option
        .setName("limit")
        .setDescription("The number of demands available to each member.")
        .setMinValue(1)
        .setMaxValue(100)
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
                    (0, embeds_js_1.createErrorEmbed)("You do not have permission to change the demand limit.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        const limit = interaction.options.getInteger("limit", true);
        const previousLimit = (0, database_js_1.getDemandLimit)(data, interaction.guild.id);
        data.settings.demandLimits[interaction.guild.id] = limit;
        (0, database_js_1.saveData)(data);
        const embed = (0, embeds_js_1.createSuccessEmbed)(interaction.guild, "Demand Limit Updated", `Each member can now leave a team up to **${limit}** times.`, [
            { name: "Previous Limit", value: String(previousLimit), inline: true },
            { name: "New Limit", value: String(limit), inline: true }
        ]);
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
exports.demandResetCommand = {
    data: new discord_js_1.SlashCommandBuilder()
        .setName("demandreset")
        .setDescription("Reset every member's used demands to zero."),
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
                    (0, embeds_js_1.createErrorEmbed)("You do not have permission to reset team demands.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        const usage = data.settings.demandUsage[interaction.guild.id] ?? {};
        const membersReset = Object.keys(usage).length;
        for (const userId of Object.keys(usage)) {
            usage[userId] = 0;
        }
        data.settings.demandUsage[interaction.guild.id] = usage;
        (0, database_js_1.saveData)(data);
        const embed = (0, embeds_js_1.createSuccessEmbed)(interaction.guild, "Demands Reset", "Every member's used demands have been reset to zero. The current demand limit has not changed.", [
            { name: "Members Reset", value: String(membersReset), inline: true },
            {
                name: "Demand Limit",
                value: String((0, database_js_1.getDemandLimit)(data, interaction.guild.id)),
                inline: true
            }
        ]).setThumbnail(interaction.guild.iconURL({ size: 128 }));
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
