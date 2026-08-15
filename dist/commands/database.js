"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPTY_TEAM_STAFF = exports.STAFF_POSITIONS = void 0;
exports.loadData = loadData;
exports.normalizeData = normalizeData;
exports.getLogChannelId = getLogChannelId;
exports.getTransactionChannelId = getTransactionChannelId;
exports.getDemandLimit = getDemandLimit;
exports.getRosterLimit = getRosterLimit;
exports.saveData = saveData;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const filePath = path_1.default.resolve(__dirname, "..", "..", "src", "users.json");
exports.STAFF_POSITIONS = [
    "assistant_manager",
    "captain",
    "coach"
];
exports.EMPTY_TEAM_STAFF = {
    assistant_manager: null,
    captain: null,
    coach: null
};
function createEmptyDatabase() {
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
function loadData() {
    if (!fs_1.default.existsSync(filePath)) {
        const data = createEmptyDatabase();
        saveData(data);
        return data;
    }
    const file = fs_1.default.readFileSync(filePath, "utf8");
    if (!file.trim()) {
        const data = createEmptyDatabase();
        saveData(data);
        return data;
    }
    return normalizeData(JSON.parse(file));
}
function normalizeData(parsed) {
    const teams = {};
    for (const [roleId, team] of Object.entries(parsed.teams ?? {})) {
        teams[roleId] = {
            managerid: typeof team.managerid === "string" ? team.managerid : "",
            staff: {
                ...exports.EMPTY_TEAM_STAFF,
                ...(team.staff ?? {})
            }
        };
    }
    return {
        teams,
        settings: {
            transactionChannel: typeof parsed.settings?.transactionChannel === "string"
                ? parsed.settings.transactionChannel
                : null,
            candidateRoles: parsed.settings?.candidateRoles ?? {},
            managerRoles: parsed.settings?.managerRoles ?? {},
            assistantManagerRoles: parsed.settings?.assistantManagerRoles ?? {},
            logChannels: parsed.settings?.logChannels ?? {},
            transactionChannels: parsed.settings?.transactionChannels ?? {},
            owner_id: typeof parsed.settings?.owner_id === "string"
                ? parsed.settings.owner_id
                : typeof parsed.settings?.ownerId === "string"
                    ? parsed.settings.ownerId
                    : "",
            whitelists: {
                echo: Array.isArray(parsed.settings?.whitelists?.echo)
                    ? parsed.settings.whitelists.echo.filter((id) => typeof id === "string")
                    : [],
                league_admin: Array.isArray(parsed.settings?.whitelists?.league_admin)
                    ? parsed.settings.whitelists.league_admin.filter((id) => typeof id === "string")
                    : []
            },
            demandLimits: Object.fromEntries(Object.entries(parsed.settings?.demandLimits ??
                parsed.settings?.demandCaps ??
                {})
                .filter((entry) => typeof entry[1] === "number" && Number.isFinite(entry[1]))
                .map(([guildId, limit]) => [
                guildId,
                Math.min(100, Math.max(1, Math.floor(limit)))
            ])),
            rosterLimits: Object.fromEntries(Object.entries(parsed.settings?.rosterLimits ?? {})
                .filter((entry) => typeof entry[1] === "number" && Number.isFinite(entry[1]))
                .map(([guildId, limit]) => [
                guildId,
                Math.min(100, Math.max(1, Math.floor(limit)))
            ])),
            demandUsage: Object.fromEntries(Object.entries(parsed.settings?.demandUsage ?? {}).map(([guildId, usage]) => [
                guildId,
                Object.fromEntries(Object.entries(usage ?? {})
                    .filter((entry) => typeof entry[1] === "number" && Number.isFinite(entry[1]))
                    .map(([userId, count]) => [
                    userId,
                    Math.max(0, Math.floor(count))
                ]))
            ]))
        }
    };
}
function getLogChannelId(data, guildId) {
    return data.settings.logChannels[guildId] ?? null;
}
function getTransactionChannelId(data, guildId) {
    return data.settings.transactionChannels[guildId] ??
        data.settings.transactionChannel;
}
function getDemandLimit(data, guildId) {
    return data.settings.demandLimits[guildId] ?? 1;
}
function getRosterLimit(data, guildId) {
    return data.settings.rosterLimits[guildId] ?? 20;
}
function saveData(data) {
    fs_1.default.writeFileSync(filePath, JSON.stringify(data, null, 4));
}
