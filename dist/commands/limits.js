"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rosterLimitCommand = void 0;
const discord_js_1 = require("discord.js");
const database_js_1 = require("./database.js");
const embeds_js_1 = require("./embeds.js");
const permissions_js_1 = require("./permissions.js");
const rosterutils_js_1 = require("./rosterutils.js");
exports.rosterLimitCommand = {
    data: new discord_js_1.SlashCommandBuilder()
        .setName("rosterlimit")
        .setDescription("Set the player limit for every team in this server.")
        .addIntegerOption(option => option
        .setName("limit")
        .setDescription("The maximum number of players on each team.")
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
                    (0, embeds_js_1.createErrorEmbed)("You do not have permission to change the roster limit.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        const limit = interaction.options.getInteger("limit", true);
        const previousLimit = (0, database_js_1.getRosterLimit)(data, interaction.guild.id);
        await interaction.deferReply({ ephemeral: true });
        try {
            await interaction.guild.members.fetch();
        }
        catch (error) {
            console.error(error);
            await interaction.editReply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("I could not load the current team rosters. Make sure Server Members Intent is enabled.", interaction.guild)
                ]
            });
            return;
        }
        const registeredTeams = Object.entries(data.teams)
            .map(([roleId, team]) => ({
            role: interaction.guild?.roles.cache.get(roleId),
            team
        }))
            .filter(entry => entry.role);
        const teamsOverLimit = registeredTeams.filter(({ role, team }) => (0, rosterutils_js_1.getRosterPlayers)(role, team).length > limit).length;
        data.settings.rosterLimits[interaction.guild.id] = limit;
        (0, database_js_1.saveData)(data);
        const embed = (0, embeds_js_1.createSuccessEmbed)(interaction.guild, "Roster Limit Updated", `Every registered team in this server can now have up to **${limit}** players.`, [
            { name: "Previous Limit", value: String(previousLimit), inline: true },
            { name: "New Limit", value: String(limit), inline: true },
            { name: "Teams Updated", value: String(registeredTeams.length), inline: true },
            { name: "Currently Over Limit", value: String(teamsOverLimit), inline: true }
        ]);
        await interaction.editReply({ embeds: [embed] });
    }
};
