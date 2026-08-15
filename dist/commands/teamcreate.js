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
        .setName("teamcreate")
        .setDescription("Create a team and assign its manager.")
        .addRoleOption(option => option
        .setName("role")
        .setDescription("The Discord role used for this team.")
        .setRequired(true))
        .addUserOption(option => option
        .setName("manager")
        .setDescription("The team's first manager.")
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
                    (0, embeds_js_1.createErrorEmbed)("You do not have permission to create teams.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        const selectedRole = interaction.options.getRole("role", true);
        const teamRole = interaction.guild.roles.cache.get(selectedRole.id);
        const manager = interaction.options.getUser("manager", true);
        if (!teamRole || teamRole.id === interaction.guild.id) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("Choose a normal Discord role for the team.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        if (data.teams[teamRole.id]) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)(`${teamRole} is already registered as a team.`, interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        if ((0, managerrole_js_1.getConfiguredManagerRole)(data, interaction.guild)?.id === teamRole.id) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("The shared manager role cannot also be used as a team role.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        if (data.settings.assistantManagerRoles[interaction.guild.id] === teamRole.id) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("The assistant manager role cannot also be used as a team role.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        if (manager.bot) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("Bots cannot manage teams.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        const existingAccess = (0, teamstaff_js_1.findTeamAccess)(data, manager.id);
        if (existingAccess) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)(`${manager} already holds a manager or team staff position.`, interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        const managerMember = await interaction.guild.members.fetch(manager.id).catch(() => null);
        if (!managerMember) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("The selected manager is no longer in this server.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        const currentTeamId = Object.keys(data.teams).find(roleId => managerMember.roles.cache.has(roleId));
        if (currentTeamId) {
            const currentTeam = interaction.guild.roles.cache.get(currentTeamId);
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)(`${manager} is already a player on ${currentTeam ?? "another registered team"}.`, interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        try {
            await (0, managerrole_js_1.assignManagerRoles)(managerMember, teamRole, data, `Team created by ${interaction.user.tag}`);
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
        data.teams[teamRole.id] = {
            managerid: manager.id,
            staff: {
                assistant_manager: null,
                captain: null,
                coach: null
            }
        };
        (0, database_js_1.saveData)(data);
        const managerRole = (0, managerrole_js_1.getConfiguredManagerRole)(data, interaction.guild);
        const embed = (0, embeds_js_1.createSuccessEmbed)(interaction.guild, "Team Created", `${teamRole} is ready and ${manager} has been appointed as manager.`, [
            { name: "Team Role", value: `${teamRole}`, inline: true },
            { name: "Manager Role", value: `${managerRole}`, inline: true },
            { name: "Created By", value: `${interaction.user}`, inline: true }
        ]).setThumbnail((0, teamembeds_js_1.getTeamThumbnail)(teamRole, interaction.guild));
        await interaction.reply({ embeds: [embed], ephemeral: true });
        await (0, teamembeds_js_1.sendTransactionRecord)(interaction.guild, data, embed);
    }
};
