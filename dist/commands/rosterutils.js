"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTeamLeadershipIds = getTeamLeadershipIds;
exports.getRosterPlayers = getRosterPlayers;
exports.isRosterFull = isRosterFull;
function getTeamLeadershipIds(team) {
    return new Set([team.managerid, ...Object.values(team.staff)].filter((id) => Boolean(id)));
}
function getRosterPlayers(teamRole, team) {
    const leadership = getTeamLeadershipIds(team);
    return [...teamRole.members.values()].filter(member => !member.user.bot && !leadership.has(member.id));
}
function isRosterFull(teamRole, team, rosterLimit) {
    return getRosterPlayers(teamRole, team).length >= rosterLimit;
}
