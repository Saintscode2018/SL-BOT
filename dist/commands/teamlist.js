"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.command = void 0;
const discord_js_1 = require("discord.js");
const database_js_1 = require("./database.js");
const embeds_js_1 = require("./embeds.js");
const rosterutils_js_1 = require("./rosterutils.js");
exports.command = {
    data: new discord_js_1.SlashCommandBuilder()
        .setName("teamlist")
        .setDescription("View every registered team in this server."),
    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({
                embeds: [(0, embeds_js_1.createErrorEmbed)("This command can only be used inside a server.")],
                ephemeral: true
            });
            return;
        }
        const data = (0, database_js_1.loadData)();
        await interaction.deferReply({ ephemeral: true });
        try {
            await interaction.guild.members.fetch();
        }
        catch (error) {
            console.error(error);
            await interaction.editReply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("I could not load the team list. Make sure Server Members Intent is enabled.", interaction.guild)
                ]
            });
            return;
        }
        const teams = Object.entries(data.teams)
            .map(([roleId, team]) => ({
            role: interaction.guild?.roles.cache.get(roleId),
            team
        }))
            .filter(entry => entry.role);
        if (!teams.length) {
            await interaction.editReply({
                embeds: [
                    (0, embeds_js_1.createStatusEmbed)({
                        guild: interaction.guild,
                        title: "No Registered Teams",
                        description: "There are no registered teams in this server yet."
                    })
                ]
            });
            return;
        }
        const rosterLimit = (0, database_js_1.getRosterLimit)(data, interaction.guild.id);
        const lines = teams.map(({ role, team }) => `${role} — ${team.managerid ? `<@${team.managerid}>` : "Vacant"} — ${(0, rosterutils_js_1.getRosterPlayers)(role, team).length}/${rosterLimit} players`);
        const embed = (0, embeds_js_1.createStatusEmbed)({
            guild: interaction.guild,
            title: "Registered Teams",
            description: lines.join("\n")
        });
        await interaction.editReply({ embeds: [embed] });
    }
};
