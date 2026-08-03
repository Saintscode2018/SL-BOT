import type { ClubMembership, LeagueUser } from '@prisma/client';

import { ValidationError } from '../domain/errors.js';
import { formatTeamIdentity, type TeamIdentitySource } from '../domain/team-label.js';
import { BOT_EMOJIS, BOT_LABELS, formatUserWithVisibleName } from './presentation/index.js';

export const teamHealthDescriptionLimit = 4_096;

export function getTeamHealthHeart(activePlayerCount: number): string {
  if (!Number.isSafeInteger(activePlayerCount) || activePlayerCount < 0) {
    throw new ValidationError('active player count must be a non-negative safe integer');
  }
  if (activePlayerCount <= 4) return '🖤';
  if (activePlayerCount <= 9) return '💛';
  if (activePlayerCount <= 15) return '💚';
  return '❤️';
}

export function formatCompactTeamHealthLine(
  team: TeamIdentitySource,
  activePlayerCount: number,
): string {
  return `${formatTeamIdentity(team, 'message')}: ${activePlayerCount} 👤, ${getTeamHealthHeart(activePlayerCount)}`;
}

export function chunkTeamHealthLines(
  lines: readonly string[],
  maximumLength = teamHealthDescriptionLimit,
): string[] {
  if (!Number.isSafeInteger(maximumLength) || maximumLength < 1) {
    throw new ValidationError('team health chunk length must be a positive safe integer');
  }

  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    if (line.length > maximumLength) {
      throw new ValidationError('a team health row exceeds the Discord description limit');
    }
    const candidate = current.length === 0 ? line : `${current}\n${line}`;
    if (candidate.length > maximumLength) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

type StaffMembership = ClubMembership & { user: LeagueUser };

export interface DetailedTeamHealthPresentation {
  team: TeamIdentitySource;
  activePlayerCount: number;
  effectiveSquadLimit: number;
  staff: readonly StaffMembership[];
  resolvedNames: ReadonlyMap<string, string | null>;
}

export function formatDetailedTeamHealthDescription(input: DetailedTeamHealthPresentation): string {
  const staffByType = new Map(
    input.staff.map((membership) => [membership.membershipType, membership.user]),
  );
  const formatStaff = (membershipType: string): string => {
    const user = staffByType.get(membershipType);
    if (user === undefined) return BOT_LABELS.vacant;
    return formatUserWithVisibleName(
      user.discordUserId,
      input.resolvedNames.get(user.discordUserId) ?? 'Unknown User',
    );
  };

  return [
    formatTeamIdentity(input.team, 'message'),
    `> ${BOT_EMOJIS.teamManager} ${BOT_LABELS.teamManager}: ${formatStaff('TEAM_MANAGER')}`,
    `> ${BOT_EMOJIS.assistantTeamManager} ${BOT_LABELS.assistantTeamManager}: ${formatStaff('ASSISTANT_MANAGER')}`,
    `> ${BOT_EMOJIS.playerManager} ${BOT_LABELS.playerManager}: ${formatStaff('PLAYER_MANAGER')}`,
    `> ${BOT_EMOJIS.roster} ${BOT_LABELS.roster}: ${input.activePlayerCount}/${input.effectiveSquadLimit}`,
    `> ${BOT_EMOJIS.health} Health: ${getTeamHealthHeart(input.activePlayerCount)}`,
  ].join('\n');
}
