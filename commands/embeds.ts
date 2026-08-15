import {
    APIEmbedField,
    ColorResolvable,
    EmbedBuilder,
    Guild
} from "discord.js";

type StatusEmbedOptions = {
    guild?: Guild | null;
    title: string;
    description: string;
    color?: ColorResolvable;
    fields?: APIEmbedField[];
};

export function createStatusEmbed(options: StatusEmbedOptions): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setColor(options.color ?? 0x5865f2)
        .setTitle(options.title)
        .setDescription(options.description)
        .setTimestamp();

    if (options.fields?.length) {
        embed.addFields(options.fields);
    }

    if (options.guild) {
        const icon = options.guild.iconURL({ size: 128 }) ?? undefined;
        embed
            .setAuthor({ name: options.guild.name, iconURL: icon })
            .setThumbnail(icon ?? null)
            .setFooter({ text: options.guild.name, iconURL: icon });
    } else {
        embed.setFooter({ text: "SLBot" });
    }

    return embed;
}

export function createErrorEmbed(
    description: string,
    guild?: Guild | null
): EmbedBuilder {
    return createStatusEmbed({
        guild,
        title: "Unable to Complete Request",
        description: `❌ ${description}`,
        color: 0xed4245
    });
}

export function createSuccessEmbed(
    guild: Guild,
    title: string,
    description: string,
    fields?: APIEmbedField[]
): EmbedBuilder {
    return createStatusEmbed({
        guild,
        title,
        description,
        fields,
        color: 0x57f287
    });
}
