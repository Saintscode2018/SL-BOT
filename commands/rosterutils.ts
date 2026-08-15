import type { GuildMember, Role } from "discord.js";

import type { Team } from "./database.js";

export function getTeamLeadershipIds(team: Team): Set<string> {
    return new Set(
        [team.managerid, ...Object.values(team.staff)].filter(
            (id): id is string => Boolean(id)
        )
    );
}

export function getRosterPlayers(teamRole: Role, team: Team): GuildMember[] {
    const leadership = getTeamLeadershipIds(team);

    return [...teamRole.members.values()].filter(member =>
        !member.user.bot && !leadership.has(member.id)
    );
}

export function isRosterFull(
    teamRole: Role,
    team: Team,
    rosterLimit: number
): boolean {
    return getRosterPlayers(teamRole, team).length >= rosterLimit;
}
