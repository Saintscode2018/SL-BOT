"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.command = void 0;
const discord_js_1 = require("discord.js");
const database_js_1 = require("./database.js");
const embeds_js_1 = require("./embeds.js");
const permissions_js_1 = require("./permissions.js");
exports.command = {
    data: new discord_js_1.SlashCommandBuilder()
        .setName("transactionchannel")
        .setDescription("Set the public channel for completed transactions.")
        .addChannelOption(option => option
        .setName("channel")
        .setDescription("The channel that will receive completed transactions.")
        .addChannelTypes(discord_js_1.ChannelType.GuildText)
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
                    (0, embeds_js_1.createErrorEmbed)("You do not have permission to configure the transaction channel.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        const selectedChannel = interaction.options.getChannel("channel", true);
        const channel = interaction.guild.channels.cache.get(selectedChannel.id);
        const botMember = interaction.guild.members.me;
        if (!channel?.isTextBased() || !botMember) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)("That text channel could not be found.", interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        const permissions = channel.permissionsFor(botMember);
        const requiredPermissions = [
            discord_js_1.PermissionFlagsBits.ViewChannel,
            discord_js_1.PermissionFlagsBits.SendMessages,
            discord_js_1.PermissionFlagsBits.EmbedLinks
        ];
        if (!permissions?.has(requiredPermissions)) {
            await interaction.reply({
                embeds: [
                    (0, embeds_js_1.createErrorEmbed)(`I need View Channel, Send Messages, and Embed Links in ${channel}.`, interaction.guild)
                ],
                ephemeral: true
            });
            return;
        }
        data.settings.transactionChannels[interaction.guild.id] = channel.id;
        (0, database_js_1.saveData)(data);
        const embed = (0, embeds_js_1.createSuccessEmbed)(interaction.guild, "Transaction Channel Set", `Completed transactions will now be posted in ${channel}.`);
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
