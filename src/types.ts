import {
    ChatInputCommandInteraction,
    RESTPostAPIChatInputApplicationCommandsJSONBody
} from "discord.js";

export type Command = {
    data: {
        readonly name: string;
        toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody;
    };
    execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
};
