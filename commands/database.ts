import fs from "fs";
import path from "path";

const filePath = path.resolve(
    __dirname,
    "..",
    "..",
    "src",
    "users.json"
);

export type Team = {
    managerid: string;
    staff: TeamStaff;
};

export const STAFF_POSITIONS = [
    "assistant_manager",
    "captain",
    "coach"
] as const;

export type StaffPosition = typeof STAFF_POSITIONS[number];

export type TeamStaff = Record<StaffPosition, string | null>;

export const EMPTY_TEAM_STAFF: TeamStaff = {
    assistant_manager: null,
    captain: null,
    coach: null
};

export type Database = {
    teams: Record<string, Team>;
    settings: {
        transactionChannel: string | null;
        candidateRoles: Record<string, string>;
        managerRoles: Record<string, string>;
        assistantManagerRoles: Record<string, string>;
        logChannels: Record<string, string>;
        transactionChannels: Record<string, string>;
        owner_id: string;
        whitelists: {
            echo: string[];
            league_admin: string[];
        };
        demandLimits: Record<string, number>;
        rosterLimits: Record<string, number>;
        demandUsage: Record<string, Record<string, number>>;
    };
};

type StoredDatabase = {
    teams?: Record<string, Partial<Team>>;
    settings?: Partial<Database["settings"]> & {
        ownerId?: string;
        demandCaps?: Record<string, number>;
    };
};

function createEmptyDatabase(): Database {
    return {
        teams: {},
        settings: {
            transactionChannel: null,
            candidateRoles: {},
            managerRoles: {},
            assistantManagerRoles: {},
            logChannels: {},
            transactionChannels: {},
            owner_id: "",
            whitelists: {
                echo: [],
                league_admin: []
            },
            demandLimits: {},
            rosterLimits: {},
            demandUsage: {}
        }
    };
}

export function loadData(): Database {
    if (!fs.existsSync(filePath)) {
        const data = createEmptyDatabase();

        saveData(data);
        return data;
    }

    const file = fs.readFileSync(filePath, "utf8");

    if (!file.trim()) {
        const data = createEmptyDatabase();

        saveData(data);
        return data;
    }

    return normalizeData(JSON.parse(file) as StoredDatabase);
}

export function normalizeData(parsed: StoredDatabase): Database {

    const teams: Record<string, Team> = {};

    for (const [roleId, team] of Object.entries(parsed.teams ?? {})) {
        teams[roleId] = {
            managerid: typeof team.managerid === "string" ? team.managerid : "",
            staff: {
                ...EMPTY_TEAM_STAFF,
                ...(team.staff ?? {})
            }
        };
    }

    return {
        teams,
        settings: {
            transactionChannel:
                typeof parsed.settings?.transactionChannel === "string"
                    ? parsed.settings.transactionChannel
                    : null,
            candidateRoles: parsed.settings?.candidateRoles ?? {},
            managerRoles: parsed.settings?.managerRoles ?? {},
            assistantManagerRoles: parsed.settings?.assistantManagerRoles ?? {},
            logChannels: parsed.settings?.logChannels ?? {},
            transactionChannels: parsed.settings?.transactionChannels ?? {},
            owner_id:
                typeof parsed.settings?.owner_id === "string"
                    ? parsed.settings.owner_id
                    : typeof parsed.settings?.ownerId === "string"
                        ? parsed.settings.ownerId
                        : "",
            whitelists: {
                echo: Array.isArray(parsed.settings?.whitelists?.echo)
                    ? parsed.settings.whitelists.echo.filter(
                        (id): id is string => typeof id === "string"
                    )
                    : [],
                league_admin: Array.isArray(parsed.settings?.whitelists?.league_admin)
                    ? parsed.settings.whitelists.league_admin.filter(
                        (id): id is string => typeof id === "string"
                    )
                    : []
            },
            demandLimits: Object.fromEntries(
                Object.entries(
                    parsed.settings?.demandLimits ??
                    parsed.settings?.demandCaps ??
                    {}
                )
                    .filter((entry): entry is [string, number] =>
                        typeof entry[1] === "number" && Number.isFinite(entry[1])
                    )
                    .map(([guildId, limit]) => [
                        guildId,
                        Math.min(100, Math.max(1, Math.floor(limit)))
                    ])
            ),
            rosterLimits: Object.fromEntries(
                Object.entries(parsed.settings?.rosterLimits ?? {})
                    .filter((entry): entry is [string, number] =>
                        typeof entry[1] === "number" && Number.isFinite(entry[1])
                    )
                    .map(([guildId, limit]) => [
                        guildId,
                        Math.min(100, Math.max(1, Math.floor(limit)))
                    ])
            ),
            demandUsage: Object.fromEntries(
                Object.entries(parsed.settings?.demandUsage ?? {}).map(
                    ([guildId, usage]) => [
                        guildId,
                        Object.fromEntries(
                            Object.entries(usage ?? {})
                                .filter((entry): entry is [string, number] =>
                                    typeof entry[1] === "number" && Number.isFinite(entry[1])
                                )
                                .map(([userId, count]) => [
                                    userId,
                                    Math.max(0, Math.floor(count))
                                ])
                        )
                    ]
                )
            )
        }
    };
}

export function getLogChannelId(data: Database, guildId: string): string | null {
    return data.settings.logChannels[guildId] ?? null;
}

export function getTransactionChannelId(
    data: Database,
    guildId: string
): string | null {
    return data.settings.transactionChannels[guildId] ??
        data.settings.transactionChannel;
}

export function getDemandLimit(data: Database, guildId: string): number {
    return data.settings.demandLimits[guildId] ?? 1;
}

export function getRosterLimit(data: Database, guildId: string): number {
    return data.settings.rosterLimits[guildId] ?? 20;
}

export function saveData(data: Database) {
    fs.writeFileSync(
        filePath,
        JSON.stringify(data, null, 4)
    );
}
