"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.command = void 0;
const discord_js_1 = require("discord.js");
const database_js_1 = require("./database.js");
const embeds_js_1 = require("./embeds.js");
const managerrole_js_1 = require("./managerrole.js");
const teamstaff_js_1 = require("./teamstaff.js");
const teamembeds_js_1 = require("./teamembeds.js");
const permissions_js_1 = require("./permissions.js");
exports.command = {
    data: new discord_js_1.SlashCommandBuilder()
        .setName("managerswap")
        .setDescription("Replace the manager of a registered team.")
        .addRoleOption(option => option
        .setName("team")
        .setDescription("The team receiving a new manager.")
        .setRequired(true))
        .addUserOption(option => option
        .setName("manager")
        .setDescription("The new manager.")
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
                    (0, embeds_js_1.createErrorEmbed)("You do not have permission to replace managers.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        const selectedRole = interaction.options.getRole("team", true);
        const teamRole = interaction.guild.roles.cache.get(selectedRole.id);
        const newManager = interaction.options.getUser("manager", true);
        const team = data.teams[selectedRole.id];
        if (!teamRole || !team) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("The selected role is not a registered team.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        if (newManager.bot) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("Bots cannot manage teams.", interaction.guild)],
                ephemeral: true
            });
            return;
        }
        if (team.managerid === newManager.id) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)(`${newManager} already manages ${teamRole}.`, interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        if ((0, teamstaff_js_1.findTeamAccess)(data, newManager.id)) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)(`${newManager} already holds a manager or team staff position.`, interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        const newManagerMember = await interaction.guild.members
            .fetch(newManager.id)
            .catch(() => null);
        if (!newManagerMember) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("The selected manager is no longer in this server.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        const otherTeamId = Object.keys(data.teams).find(roleId => roleId !== teamRole.id && newManagerMember.roles.cache.has(roleId));
        if (otherTeamId) {
            const otherTeam = interaction.guild.roles.cache.get(otherTeamId);
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)(`${newManager} is already a player on ${otherTeam ?? "another registered team"}.`, interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        try {
            await (0, managerrole_js_1.assignManagerRoles)(newManagerMember, teamRole, data, `Manager changed by ${interaction.user.tag}`);
        }
        catch (error) {
            const message = error instanceof Error
                ? error.message
                : "I could not assign the required manager roles.";
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)(message, interaction.guild)],
                ephemeral: true
            });
            return;
        }
        const previousManagerId = team.managerid;
        team.managerid = newManager.id;
        (0, database_js_1.saveData)(data);
        const oldRoleRemoved = previousManagerId
            ? await (0, managerrole_js_1.removeFormerManagerRoles)(interaction.guild, previousManagerId, teamRole, data, `No longer managing a team after change by ${interaction.user.tag}`)
            : true;
        const description = oldRoleRemoved
            ? `${newManager} is now the manager of ${teamRole}.`
            : `${newManager} is now the manager of ${teamRole}. The previous manager's roles need manual removal.`;
        const fields = [
            {
                name: "Previous Manager",
                value: previousManagerId ? `<@${previousManagerId}>` : "Vacant",
                inline: true
            },
            { name: "New Manager", value: `${newManager}`, inline: true },
            { name: "Changed By", value: `${interaction.user}`, inline: true }
        ];
        const embed = oldRoleRemoved
            ? (0, embeds_js_1.createSuccessEmbed)(interaction.guild, "Manager Changed", description, fields)
            : (0, embeds_js_1.createStatusEmbed)({
                guild: interaction.guild,
                title: "Manager Changed with a Warning",
                description,
                fields,
                color: 0xfee75c
            });
        embed.setThumbnail((0, teamembeds_js_1.getTeamThumbnail)(teamRole, interaction.guild));
        await interaction.reply({ embeds: [embed], ephemeral: true });
        await (0, teamembeds_js_1.sendTransactionRecord)(interaction.guild, data, embed);
    }
};
