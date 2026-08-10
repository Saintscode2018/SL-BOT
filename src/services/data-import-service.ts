import type {
  Club,
  ClubMembership,
  Guild,
  GuildSettings,
  LeagueUser,
  PrismaClient,
} from '@prisma/client';

import type { MembershipType } from '../domain/enums.js';
import { ConfigurationError, DataImportAuditRecordingError } from '../domain/errors.js';
import { getEffectiveSquadLimit } from '../domain/squad-limit.js';
import { AuditEventRepository } from '../repositories/audit-event-repository.js';
import { ClubRepository } from '../repositories/club-repository.js';
import { GuildRepository } from '../repositories/guild-repository.js';
import { MembershipRepository } from '../repositories/membership-repository.js';
import { UserRepository } from '../repositories/user-repository.js';
import { AuthorizationService, type AuthorizationInput } from './authorization-service.js';

export const dataImportAuditEventType = 'data.imported';

export interface GuildMemberSnapshot {
  discordUserId: string;
  displayName: string;
  roleIds: readonly string[];
  bot: boolean;
}

export type DataImportIssueCode =
  | 'MULTIPLE_TEAM_ROLES'
  | 'MULTIPLE_MANAGEMENT_ROLES'
  | 'MANAGEMENT_WITHOUT_TEAM'
  | 'CONFLICTING_MEMBERSHIP'
  | 'STAFF_SLOT_CONFLICT'
  | 'SQUAD_LIMIT_REACHED'
  | 'STALE_IMPORT_PLAN';

export interface DataImportIssue {
  code: DataImportIssueCode;
  discordUserId: string;
  displayName: string;
  reason: string;
}

export interface DataImportCounts {
  players: number;
  teamManagers: number;
  assistantManagers: number;
  playerManagers: number;
}

export interface DataImportResult {
  guild: Guild;
  settings: GuildSettings;
  imported: DataImportCounts;
  unchanged: number;
  issues: DataImportIssue[];
  scannedMembers: number;
  ignoredBots: number;
  occurredAt: Date;
}

export interface DataImportInput {
  authorization: AuthorizationInput;
  fetchMembers(): Promise<readonly GuildMemberSnapshot[]>;
  occurredAt?: Date;
}

interface ImportCandidate {
  member: GuildMemberSnapshot;
  club: Club;
  membershipType: MembershipType;
  expectedMembershipTypes: readonly MembershipType[];
}

type ExistingAssessment = 'MISSING' | 'UNCHANGED' | 'CONFLICT';
type PersistenceOutcome =
  | 'IMPORTED'
  | 'UNCHANGED'
  | 'CONFLICT'
  | 'STAFF_SLOT_CONFLICT'
  | 'SQUAD_LIMIT_REACHED'
  | 'STALE_PLAN';

const staffMembershipTypes = [
  'TEAM_MANAGER',
  'ASSISTANT_MANAGER',
  'PLAYER_MANAGER',
] as const satisfies readonly MembershipType[];

function isStaffMembershipType(
  membershipType: string,
): membershipType is Exclude<MembershipType, 'PLAYER'> {
  return staffMembershipTypes.includes(membershipType as (typeof staffMembershipTypes)[number]);
}

function issue(
  candidate: Pick<ImportCandidate, 'member'>,
  code: DataImportIssueCode,
  reason: string,
): DataImportIssue {
  return {
    code,
    discordUserId: candidate.member.discordUserId,
    displayName: candidate.member.displayName,
    reason,
  };
}

function assessExistingMemberships(
  candidate: ImportCandidate,
  activeMemberships: readonly ClubMembership[],
): ExistingAssessment {
  if (activeMemberships.length === 0) return 'MISSING';

  const expectedTypes = new Set(candidate.expectedMembershipTypes);
  const activeTypeCounts = new Map<MembershipType, number>();
  for (const { clubId, membershipType } of activeMemberships) {
    if (clubId !== candidate.club.id || !expectedTypes.has(membershipType as MembershipType)) {
      return 'CONFLICT';
    }
    const typedMembershipType = membershipType as MembershipType;
    activeTypeCounts.set(typedMembershipType, (activeTypeCounts.get(typedMembershipType) ?? 0) + 1);
  }

  if (
    activeMemberships.length === candidate.expectedMembershipTypes.length &&
    candidate.expectedMembershipTypes.every(
      (membershipType) => activeTypeCounts.get(membershipType) === 1,
    )
  ) {
    return 'UNCHANGED';
  }

  if ([...activeTypeCounts.values()].some((count) => count > 1)) return 'CONFLICT';
  return 'MISSING';
}

function expectedMembershipTypesFor(
  managementType: Exclude<MembershipType, 'PLAYER'> | undefined,
): readonly MembershipType[] {
  return managementType === undefined ? ['PLAYER'] : ['PLAYER', managementType];
}

function staffSlotKey(candidate: ImportCandidate): string {
  return `${candidate.club.id}:${candidate.membershipType}`;
}

function incrementImported(counts: DataImportCounts, membershipType: MembershipType): void {
  switch (membershipType) {
    case 'PLAYER':
      counts.players += 1;
      break;
    case 'TEAM_MANAGER':
      counts.teamManagers += 1;
      break;
    case 'ASSISTANT_MANAGER':
      counts.assistantManagers += 1;
      break;
    case 'PLAYER_MANAGER':
      counts.playerManagers += 1;
      break;
  }
}

function managementLabel(membershipType: MembershipType): string {
  switch (membershipType) {
    case 'TEAM_MANAGER':
      return 'Team Manager';
    case 'ASSISTANT_MANAGER':
      return 'Assistant Manager';
    case 'PLAYER_MANAGER':
      return 'Player Manager';
    case 'PLAYER':
      return 'Player';
  }
}

function validatePrerequisites(settings: GuildSettings): void {
  const missingChannels = [
    ['Bot Commands', settings.botCommandsChannelId],
    ['Staff Commands', settings.staffChannelId],
    ['Transfer Market', settings.transferChannelId],
    ['Audit', settings.auditChannelId],
  ]
    .filter(([, channelId]) => channelId === null)
    .map(([name]) => name);
  if (missingChannels.length > 0) {
    throw new ConfigurationError(
      `Complete \`/setup channels\` before importing data. Missing: ${missingChannels.join(', ')}.`,
    );
  }

  const missingRoles = [
    ['TM', settings.teamManagerRoleId],
    ['ATM', settings.assistantManagerRoleId],
    ['PM', settings.playerManagerRoleId],
  ]
    .filter(([, roleId]) => roleId === null)
    .map(([name]) => name);
  if (missingRoles.length > 0) {
    throw new ConfigurationError(
      `Complete \`/setup roles\` before importing data. Missing: ${missingRoles.join(', ')}.`,
    );
  }
  if (
    new Set([
      settings.teamManagerRoleId,
      settings.assistantManagerRoleId,
      settings.playerManagerRoleId,
    ]).size !== 3
  ) {
    throw new ConfigurationError(
      'Configure distinct TM, ATM, and PM roles with `/setup roles` before importing data.',
    );
  }
}

function hasSameManagementRoleConfiguration(
  expected: GuildSettings,
  current: GuildSettings,
): boolean {
  return (
    expected.teamManagerRoleId === current.teamManagerRoleId &&
    expected.assistantManagerRoleId === current.assistantManagerRoleId &&
    expected.playerManagerRoleId === current.playerManagerRoleId
  );
}

function classifyMembers(
  members: readonly GuildMemberSnapshot[],
  clubs: readonly Club[],
  settings: GuildSettings,
): { candidates: ImportCandidate[]; issues: DataImportIssue[]; ignoredBots: number } {
  const clubsByRoleId = new Map(clubs.map((club) => [club.discordRoleId, club]));
  const managementRoles = new Map<string, Exclude<MembershipType, 'PLAYER'>>([
    [settings.teamManagerRoleId!, 'TEAM_MANAGER'],
    [settings.assistantManagerRoleId!, 'ASSISTANT_MANAGER'],
    [settings.playerManagerRoleId!, 'PLAYER_MANAGER'],
  ]);
  const candidates: ImportCandidate[] = [];
  const issues: DataImportIssue[] = [];
  let ignoredBots = 0;

  for (const member of [...members].sort((left, right) =>
    left.discordUserId.localeCompare(right.discordUserId),
  )) {
    if (member.bot) {
      ignoredBots += 1;
      continue;
    }
    const roleIds = new Set(member.roleIds);
    const matchingClubs = [...clubsByRoleId.entries()]
      .filter(([roleId]) => roleIds.has(roleId))
      .map(([, club]) => club);
    const matchingManagementTypes = [...managementRoles.entries()]
      .filter(([roleId]) => roleIds.has(roleId))
      .map(([, membershipType]) => membershipType);

    if (matchingClubs.length > 1) {
      issues.push(
        issue(
          { member },
          'MULTIPLE_TEAM_ROLES',
          `multiple active registered team roles (${matchingClubs
            .map(({ discordRoleId }) => `<@&${discordRoleId}>`)
            .join(', ')})`,
        ),
      );
      continue;
    }
    if (matchingManagementTypes.length > 1) {
      issues.push(
        issue({ member }, 'MULTIPLE_MANAGEMENT_ROLES', 'multiple configured management roles'),
      );
      continue;
    }
    const club = matchingClubs[0];
    const managementType = matchingManagementTypes[0];
    if (club === undefined) {
      if (managementType !== undefined) {
        issues.push(
          issue(
            { member },
            'MANAGEMENT_WITHOUT_TEAM',
            'management role without an active registered team role',
          ),
        );
      }
      continue;
    }
    candidates.push({
      member,
      club,
      membershipType: managementType ?? 'PLAYER',
      expectedMembershipTypes: expectedMembershipTypesFor(managementType),
    });
  }

  return { candidates, issues, ignoredBots };
}

function issuesByCode(issues: readonly DataImportIssue[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const current of issues) counts[current.code] = (counts[current.code] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export class DataImportService {
  public constructor(private readonly database: PrismaClient) {}

  public async importGuild(input: DataImportInput): Promise<DataImportResult> {
    const authorization = await new AuthorizationService(
      this.database,
    ).authorizeLeagueAdministration(input.authorization);
    validatePrerequisites(authorization.settings);

    const clubs = await new ClubRepository(this.database).listActive(authorization.guild.id);
    if (clubs.length === 0) {
      throw new ConfigurationError(
        'Register at least one active team with `/team add` before importing data.',
      );
    }

    const memberships = new MembershipRepository(this.database);
    const users = new UserRepository(this.database);
    const [activeMemberships, actor] = await Promise.all([
      memberships.listActiveMembershipsForGuildWithUsers(authorization.guild.id),
      users.getByDiscordUserId(input.authorization.discordUserId),
    ]);
    if (actor === null) {
      throw new ConfigurationError('The authorized import actor has no LeagueUser record.');
    }

    const fetchedMembers = await input.fetchMembers();
    const classified = classifyMembers(fetchedMembers, clubs, authorization.settings);
    const importIssues = [...classified.issues];
    const imported: DataImportCounts = {
      players: 0,
      teamManagers: 0,
      assistantManagers: 0,
      playerManagers: 0,
    };
    let unchanged = 0;

    const activeByDiscordUserId = new Map<string, Array<ClubMembership & { user: LeagueUser }>>();
    for (const membership of activeMemberships) {
      const current = activeByDiscordUserId.get(membership.user.discordUserId) ?? [];
      current.push(membership);
      activeByDiscordUserId.set(membership.user.discordUserId, current);
    }

    const activeStaffBySlot = new Map<string, ClubMembership & { user: LeagueUser }>();
    for (const membership of activeMemberships) {
      if (isStaffMembershipType(membership.membershipType)) {
        activeStaffBySlot.set(`${membership.clubId}:${membership.membershipType}`, membership);
      }
    }

    const missingCandidates: ImportCandidate[] = [];
    for (const candidate of classified.candidates) {
      const current = activeByDiscordUserId.get(candidate.member.discordUserId) ?? [];
      const assessment = assessExistingMemberships(candidate, current);
      if (assessment === 'UNCHANGED') {
        unchanged += 1;
        continue;
      }
      if (assessment === 'CONFLICT') {
        importIssues.push(
          issue(
            candidate,
            'CONFLICTING_MEMBERSHIP',
            `conflicting active database membership for <@&${candidate.club.discordRoleId}>`,
          ),
        );
        continue;
      }
      const missingMembershipTypes = candidate.expectedMembershipTypes.filter(
        (membershipType) =>
          !current.some(
            ({ clubId, membershipType: activeType }) =>
              clubId === candidate.club.id && activeType === membershipType,
          ),
      );
      const occupiedStaffType = missingMembershipTypes.find((membershipType) => {
        if (membershipType === 'PLAYER') return false;
        const occupied = activeStaffBySlot.get(staffSlotKey({ ...candidate, membershipType }));
        return (
          occupied !== undefined && occupied.user.discordUserId !== candidate.member.discordUserId
        );
      });
      if (occupiedStaffType !== undefined) {
        importIssues.push(
          issue(
            candidate,
            'STAFF_SLOT_CONFLICT',
            `${managementLabel(occupiedStaffType)} position is already occupied for <@&${candidate.club.discordRoleId}>`,
          ),
        );
        continue;
      }
      for (const membershipType of missingMembershipTypes) {
        const missingCandidate = { ...candidate, membershipType };
        missingCandidates.push(missingCandidate);
      }
    }

    const openStaffCandidatesBySlot = new Map<string, ImportCandidate[]>();
    for (const candidate of missingCandidates) {
      if (candidate.membershipType === 'PLAYER') continue;
      const key = staffSlotKey(candidate);
      const current = openStaffCandidatesBySlot.get(key) ?? [];
      current.push(candidate);
      openStaffCandidatesBySlot.set(key, current);
    }
    const ambiguousStaffCandidates = new Set<ImportCandidate>();
    for (const candidates of openStaffCandidatesBySlot.values()) {
      if (candidates.length < 2) continue;
      for (const candidate of candidates) {
        ambiguousStaffCandidates.add(candidate);
        importIssues.push(
          issue(
            candidate,
            'STAFF_SLOT_CONFLICT',
            `multiple members hold the same ${managementLabel(candidate.membershipType)} role for <@&${candidate.club.discordRoleId}>`,
          ),
        );
      }
    }

    const occurredAt = input.occurredAt ?? new Date();
    for (const candidate of missingCandidates) {
      if (ambiguousStaffCandidates.has(candidate)) continue;
      const outcome = await this.persistCandidate(
        authorization.guild,
        authorization.settings,
        actor,
        candidate,
        occurredAt,
      );
      switch (outcome) {
        case 'IMPORTED':
          incrementImported(imported, candidate.membershipType);
          break;
        case 'UNCHANGED':
          unchanged += 1;
          break;
        case 'CONFLICT':
          importIssues.push(
            issue(
              candidate,
              'CONFLICTING_MEMBERSHIP',
              `conflicting active database membership for <@&${candidate.club.discordRoleId}>`,
            ),
          );
          break;
        case 'STAFF_SLOT_CONFLICT':
          importIssues.push(
            issue(
              candidate,
              'STAFF_SLOT_CONFLICT',
              `${managementLabel(candidate.membershipType)} position is already occupied for <@&${candidate.club.discordRoleId}>`,
            ),
          );
          break;
        case 'SQUAD_LIMIT_REACHED':
          importIssues.push(
            issue(
              candidate,
              'SQUAD_LIMIT_REACHED',
              `squad limit reached for <@&${candidate.club.discordRoleId}>`,
            ),
          );
          break;
        case 'STALE_PLAN':
          importIssues.push(
            issue(
              candidate,
              'STALE_IMPORT_PLAN',
              'team or management-role configuration changed while the import was running',
            ),
          );
          break;
      }
    }

    importIssues.sort(
      (left, right) =>
        left.discordUserId.localeCompare(right.discordUserId) ||
        left.code.localeCompare(right.code),
    );
    try {
      await new AuditEventRepository(this.database).create({
        guildId: authorization.guild.id,
        actorUserId: actor.id,
        eventType: dataImportAuditEventType,
        entityType: 'guild',
        entityId: authorization.guild.id,
        afterState: {
          imported: {
            players: imported.players,
            teamManagers: imported.teamManagers,
            assistantManagers: imported.assistantManagers,
            playerManagers: imported.playerManagers,
          },
          unchanged,
          skipped: importIssues.length,
        },
        metadata: {
          discordGuildId: authorization.guild.discordGuildId,
          actorDiscordUserId: input.authorization.discordUserId,
          scannedMembers: fetchedMembers.length,
          ignoredBots: classified.ignoredBots,
          issuesByCode: issuesByCode(importIssues),
        },
      });
    } catch (error: unknown) {
      throw new DataImportAuditRecordingError({ cause: error });
    }

    return {
      guild: authorization.guild,
      settings: authorization.settings,
      imported,
      unchanged,
      issues: importIssues,
      scannedMembers: fetchedMembers.length,
      ignoredBots: classified.ignoredBots,
      occurredAt,
    };
  }

  private async persistCandidate(
    guild: Guild,
    settings: GuildSettings,
    actor: LeagueUser,
    candidate: ImportCandidate,
    occurredAt: Date,
  ): Promise<PersistenceOutcome> {
    return this.database.$transaction(async (transaction) => {
      const guilds = new GuildRepository(transaction);
      await guilds.acquireWriteLock(guild.discordGuildId);
      const [currentSettings, currentClub] = await Promise.all([
        guilds.getSettings(guild.id),
        new ClubRepository(transaction).getByIdInGuild(candidate.club.id, guild.id),
      ]);
      if (
        currentSettings === null ||
        !hasSameManagementRoleConfiguration(settings, currentSettings) ||
        currentClub === null ||
        !currentClub.active ||
        currentClub.discordRoleId !== candidate.club.discordRoleId
      ) {
        return 'STALE_PLAN';
      }

      const users = new UserRepository(transaction);
      const memberships = new MembershipRepository(transaction);
      const user = await users.getOrCreateByDiscordUserId(candidate.member.discordUserId);
      const active = await memberships.listActiveMembershipsForUserInGuild(guild.id, user.id);
      const assessment = assessExistingMemberships(candidate, active);
      if (assessment === 'CONFLICT') return 'CONFLICT';
      if (
        assessment === 'UNCHANGED' ||
        active.some(
          ({ clubId, membershipType }) =>
            clubId === candidate.club.id && membershipType === candidate.membershipType,
        )
      ) {
        return 'UNCHANGED';
      }

      const alreadyOnClub = active.some((membership) => membership.clubId === candidate.club.id);
      if (
        !alreadyOnClub &&
        (await memberships.countActiveUniqueMembers(currentClub.id)) >=
          getEffectiveSquadLimit(currentClub, currentSettings)
      ) {
        return 'SQUAD_LIMIT_REACHED';
      }

      if (candidate.membershipType !== 'PLAYER') {
        const occupied = await memberships.getActiveStaffAppointment(
          currentClub.id,
          candidate.membershipType,
        );
        if (occupied !== null && occupied.userId !== user.id) return 'STAFF_SLOT_CONFLICT';
      }

      await memberships.createActive({
        guildId: guild.id,
        clubId: currentClub.id,
        userId: user.id,
        membershipType: candidate.membershipType,
        joinedAt: occurredAt,
        createdByUserId: actor.id,
      });
      return 'IMPORTED';
    });
  }
}
