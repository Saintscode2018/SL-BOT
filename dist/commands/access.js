"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.echoCommand = exports.whitelistCommand = void 0;
const discord_js_1 = require("discord.js");
const database_js_1 = require("./database.js");
const embeds_js_1 = require("./embeds.js");
const permissions_js_1 = require("./permissions.js");
const scopeNames = {
    echo: "Echo",
    league_admin: "League Administration"
};
exports.whitelistCommand = {
    data: new discord_js_1.SlashCommandBuilder()
        .setName("whitelist")
        .setDescription("Manage access to restricted bot commands.")
        .addStringOption(option => option
        .setName("scope")
        .setDescription("The access list to update.")
        .setRequired(true)
        .addChoices({ name: "Echo", value: "echo" }, { name: "League Administration", value: "league_admin" }))
        .addStringOption(option => option
        .setName("action")
        .setDescription("Add or remove access.")
        .setRequired(true)
        .addChoices({ name: "Add", value: "add" }, { name: "Remove", value: "remove" }))
        .addUserOption(option => option
        .setName("user")
        .setDescription("The person whose access should be changed.")
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
        if (!(0, permissions_js_1.isOwner)(data, interaction.user.id)) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("Only the bot owner can change command access.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        const scope = interaction.options.getString("scope", true);
        const action = interaction.options.getString("action", true);
        const user = interaction.options.getUser("user", true);
        const list = data.settings.whitelists[scope];
        if (user.id === data.settings.owner_id) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("The bot owner already has access to every restricted command.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        if (action === "add") {
            if (list.includes(user.id)) {
                await interaction.reply({
                    embeds: [
                        (0, embeds_js_1.createErrorEmbed)(`${user} already has ${scopeNames[scope]} access.`, interaction.guild)
                    ],
                    ephemeral: true
                });
                return;
            }
            list.push(user.id);
        }
        else {
            const index = list.indexOf(user.id);
            if (index === -1) {
                await interaction.reply({
                    embeds: [
                        (0, embeds_js_1.createErrorEmbed)(`${user} does not have ${scopeNames[scope]} access.`, interaction.guild)
                    ],
                    ephemeral: true
                });
                return;
            }
            list.splice(index, 1);
        }
        (0, database_js_1.saveData)(data);
        const description = action === "add"
            ? `${user} can now use commands covered by **${scopeNames[scope]}**.`
            : `${user} no longer has access to commands covered by **${scopeNames[scope]}**.`;
        await interaction.reply({
            embeds: [
                (0, embeds_js_1.createSuccessEmbed)(interaction.guild, action === "add" ? "Access Granted" : "Access Removed", description)
            ],
            ephemeral: true
        });
    }
};
exports.echoCommand = {
    data: new discord_js_1.SlashCommandBuilder()
        .setName("echo")
        .setDescription("Send an announcement through the bot.")
        .addStringOption(option => option
        .setName("message")
        .setDescription("The announcement to send.")
        .setMaxLength(2000)
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
        if (!(0, permissions_js_1.hasAccess)(data, interaction.user.id, "echo")) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("You do not have permission to use this command.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        const message = interaction.options.getString("message", true);
        const embed = (0, embeds_js_1.createSuccessEmbed)(interaction.guild, "Announcement", message);
        await interaction.reply({ embeds: [embed] });
    }
};
