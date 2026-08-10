import type { Club, Guild, GuildSettings } from '@prisma/client';

import { DiscordRoleMissingError } from '../domain/errors.js';
import type { MembershipType } from '../domain/enums.js';
import type { DatabaseClient } from '../domain/types.js';
import type { MemberRoleMutationPlan, PlannedDiscordRole } from '../domain/roster-mutation.js';

export interface ClubRoleCandidate {
  userId: string;
  discordUserId: string;
  membershipTypes: readonly MembershipType[];
}

export interface ClubRoleRemovalPlan {
  rolePlans: MemberRoleMutationPlan[];
  expectedCandidateActiveMembershipIds: string[];
}

/**
 * Plans only roles that cease to be justified after a club's memberships are
 * ended. A member can retain a role through another current active club, even
 * when an historical club has the same Discord team-role ID.
 */
export async function planClubRoleRemovals(
  database: DatabaseClient,
  input: {
    guild: Guild;
    settings: GuildSettings;
    club: Club;
    candidates: readonly ClubRoleCandidate[];
  },
): Promise<ClubRoleRemovalPlan> {
  const userIds = [...new Set(input.candidates.map(({ userId }) => userId))];
  const candidateActiveMemberships = await database.clubMembership.findMany({
    where: { guildId: input.guild.id, userId: { in: userIds }, status: 'ACTIVE' },
    orderBy: [{ id: 'asc' }],
  });
  const entitlementMemberships = await database.clubMembership.findMany({
    where: {
      guildId: input.guild.id,
      userId: { in: userIds },
      status: 'ACTIVE',
      clubId: { not: input.club.id },
      club: { active: true },
    },
    include: { club: true },
    orderBy: [{ id: 'asc' }],
  });

  const entitlementRoleIdsByUser = new Map<string, Set<string>>();
  for (const membership of entitlementMemberships) {
    const roles = entitlementRoleIdsByUser.get(membership.userId) ?? new Set<string>();
    roles.add(membership.club.discordRoleId);
    const staffRole = configuredStaffRole(input.settings, membership.membershipType as MembershipType);
    if (staffRole !== null) roles.add(staffRole.id);
    entitlementRoleIdsByUser.set(membership.userId, roles);
  }

  const rolePlans = input.candidates.flatMap((candidate) => {
    const candidateRoles = rolesForHistoricalMembership(input.settings, input.club, candidate);
    const entitlements = entitlementRoleIdsByUser.get(candidate.userId) ?? new Set<string>();
    const removeRoles = candidateRoles.filter(({ id }) => !entitlements.has(id));
    return removeRoles.length === 0
      ? []
      : [
          {
            discordGuildId: input.guild.discordGuildId,
            discordUserId: candidate.discordUserId,
            addRoles: [],
            removeRoles,
          },
        ];
  });

  return {
    rolePlans,
    expectedCandidateActiveMembershipIds: candidateActiveMemberships.map(({ id }) => id),
  };
}

export function groupClubRoleCandidates(
  memberships: ReadonlyArray<{
    userId: string;
    membershipType: string;
    user: { discordUserId: string };
  }>,
): ClubRoleCandidate[] {
  const byUser = new Map<string, { discordUserId: string; membershipTypes: Set<MembershipType> }>();
  for (const membership of memberships) {
    const candidate = byUser.get(membership.userId) ?? {
      discordUserId: membership.user.discordUserId,
      membershipTypes: new Set<MembershipType>(),
    };
    if (isMembershipType(membership.membershipType)) {
      candidate.membershipTypes.add(membership.membershipType);
    }
    byUser.set(membership.userId, candidate);
  }
  return [...byUser.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([userId, candidate]) => ({
      userId,
      discordUserId: candidate.discordUserId,
      membershipTypes: [...candidate.membershipTypes],
    }));
}

export function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((id, index) => id === sortedRight[index]);
}

function rolesForHistoricalMembership(
  settings: GuildSettings,
  club: Club,
  candidate: ClubRoleCandidate,
): PlannedDiscordRole[] {
  const roles = new Map<string, PlannedDiscordRole>([
    [club.discordRoleId, { id: club.discordRoleId, purpose: 'TEAM' }],
  ]);
  for (const membershipType of candidate.membershipTypes) {
    const role = configuredStaffRole(settings, membershipType);
    if (role !== null && !roles.has(role.id)) roles.set(role.id, role);
  }
  return [...roles.values()];
}

function configuredStaffRole(
  settings: GuildSettings,
  membershipType: MembershipType,
): PlannedDiscordRole | null {
  if (membershipType === 'PLAYER') return null;
  const purpose =
    membershipType === 'TEAM_MANAGER'
      ? 'TM'
      : membershipType === 'ASSISTANT_MANAGER'
        ? 'ATM'
        : 'PM';
  const id =
    purpose === 'TM'
      ? settings.teamManagerRoleId
      : purpose === 'ATM'
        ? settings.assistantManagerRoleId
        : settings.playerManagerRoleId;
  if (id === null) throw new DiscordRoleMissingError(purpose);
  return { id, purpose };
}

function isMembershipType(value: string): value is MembershipType {
  return (
    value === 'PLAYER' ||
    value === 'TEAM_MANAGER' ||
    value === 'ASSISTANT_MANAGER' ||
    value === 'PLAYER_MANAGER'
  );
}
