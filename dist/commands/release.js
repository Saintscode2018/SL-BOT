"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.command = void 0;
const discord_js_1 = require("discord.js");
const database_js_1 = require("./database.js");
const teamstaff_js_1 = require("./teamstaff.js");
const embeds_js_1 = require("./embeds.js");
const teamembeds_js_1 = require("./teamembeds.js");
exports.command = {
    data: new discord_js_1.SlashCommandBuilder()
        .setName("release")
        .setDescription("Release a player from your team.")
        .addUserOption(option => option
        .setName("player")
        .setDescription("The player you want to release.")
        .setRequired(true)),
    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("This command can only be used inside a server.")],
                ephemeral: true
            });
            return;
        }
        const player = interaction.options.getUser("player", true);
        const data = (0, database_js_1.loadData)();
        const access = (0, teamstaff_js_1.findTeamAccess)(data, interaction.user.id);
        if (!access) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("Only a manager, assistant manager, captain, or coach can release players.")
                ],
                ephemeral: true
            });
            return;
        }
        if (!access.team.managerid) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("This team is frozen until a new manager is appointed.")],
                ephemeral: true
            });
            return;
        }
        const teamRole = interaction.guild.roles.cache.get(access.teamRoleId);
        if (!teamRole) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("Your team role could not be found.")],
                ephemeral: true
            });
            return;
        }
        const member = await interaction.guild.members.fetch(player.id).catch(() => null);
        if (!member) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("That player is no longer in this server.")],
                ephemeral: true
            });
            return;
        }
        if (!member.roles.cache.has(teamRole.id)) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)(`${player} is not on your team.`)],
                ephemeral: true
            });
            return;
        }
        if (player.id === access.team.managerid || (0, teamstaff_js_1.isTeamStaffMember)(access.team, player.id)) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("Managers and team staff cannot be released as players. Demote staff first.")
                ],
                ephemeral: true
            });
            return;
        }
        try {
            await member.roles.remove(teamRole, `Released by ${interaction.user.tag}`);
        }
        catch (error) {
            console.error(error);
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)(`I could not remove ${teamRole} from ${player}. Check Manage Roles and the role order.`)
                ],
                ephemeral: true
            });
            return;
        }
        const embed = (0, teamembeds_js_1.createTeamTransactionEmbed)({
            guild: interaction.guild,
            teamRole,
            team: access.team,
            data,
            title: `Player Released - ${teamRole.name}`,
            description: `> ${member} has been released from ${(0, teamembeds_js_1.getTeamEmoji)(teamRole)} ${teamRole}.`,
            color: 0xed4245,
            extraFields: [
                {
                    name: "👤 Released By",
                    value: `${interaction.user}`,
                    inline: true
                }
            ]
        });
        await interaction.reply({ embeds: [embed], ephemeral: true });
        await (0, teamembeds_js_1.sendTransactionRecord)(interaction.guild, data, embed);
    }
};
