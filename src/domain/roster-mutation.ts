import type { MembershipType } from './enums.js';
import type { TeamIdentitySource } from './team-label.js';

export type StaffMembershipType = Exclude<MembershipType, 'PLAYER'>;
export type StaffRoleCode = 'TM' | 'ATM' | 'PM';
export type DiscordRolePurpose = 'TEAM' | StaffRoleCode;

export interface PlannedDiscordRole {
  id: string;
  purpose: DiscordRolePurpose;
}

export interface MemberRoleMutationPlan {
  discordGuildId: string;
  discordUserId: string;
  addRoles: PlannedDiscordRole[];
  removeRoles: PlannedDiscordRole[];
}

export type UserTransferAnnouncementType =
  | 'SIGNED'
  | 'DEMANDED'
  | 'RELEASED'
  | 'PROMOTED'
  | 'DEMOTED'
  | 'APPOINTED';

export type TransferAnnouncementType = UserTransferAnnouncementType | 'TEAM_DISBANDED';

export interface TransferUserPresentation {
  username: string;
  avatarUrl?: string | null;
}

export interface TransferAnnouncementPresentation {
  serverName: string;
  serverIconUrl?: string | null;
  teamRoleName?: string | null;
  teamRoleColor?: number | null;
  subject?: TransferUserPresentation | null;
  actor?: TransferUserPresentation | null;
  teamManager?: TransferUserPresentation | null;
}

export interface TransferRosterPresentation {
  currentSize: number;
  maximumSize: number;
  teamManagerDiscordUserId?: string | null;
}

export interface UserTransferAnnouncementPlan {
  discordGuildId: string;
  channelId: string;
  type: UserTransferAnnouncementType;
  discordUserId: string;
  teamIdentity: TeamIdentitySource;
  occurredAt: Date;
  actorDiscordUserId?: string;
  staffRole?: StaffRoleCode;
  staffRoleId?: string;
  departureMode?: 'STAFF_ONLY' | 'FULL';
  retainsPlayerMembership?: boolean;
  roster?: TransferRosterPresentation;
  presentation?: TransferAnnouncementPresentation;
}

export interface TeamDisbandTransferAnnouncementPlan {
  discordGuildId: string;
  channelId: string;
  type: 'TEAM_DISBANDED';
  teamIdentity: TeamIdentitySource;
  occurredAt: Date;
  actorDiscordUserId?: string;
  staffRole?: StaffRoleCode;
  staffRoleId?: string;
  departureMode?: 'STAFF_ONLY' | 'FULL';
  roster?: TransferRosterPresentation;
  presentation?: TransferAnnouncementPresentation;
}

export interface TeamSwapDetails {
  team1MovedCount: number;
  team2MovedCount: number;
  team1StaffCount?: number;
  team1PlayerCount?: number;
  team2StaffCount?: number;
  team2PlayerCount?: number;
}

export interface TeamSwapTransferAnnouncementPlan {
  discordGuildId: string;
  channelId: string;
  type: 'TEAM_SWAPPED';
  team1Identity: TeamIdentitySource;
  team2Identity: TeamIdentitySource;
  occurredAt: Date;
  swapDetails: TeamSwapDetails;
  presentation?: TransferAnnouncementPresentation;
}

export type TransferAnnouncementPlan =
  | UserTransferAnnouncementPlan
  | TeamDisbandTransferAnnouncementPlan
  | TeamSwapTransferAnnouncementPlan;

export type UserAuditAnnouncementOperation =
  | 'ROSTER_PLAYER_ADDED'
  | 'ROSTER_PLAYER_REMOVED'
  | 'STAFF_APPOINTED'
  | 'STAFF_REMOVED'
  | 'ROSTER_DEMANDED'
  | 'ROSTER_RELEASED'
  | 'ROSTER_PROMOTED'
  | 'ROSTER_DEMOTED';

export type OfferAuditAnnouncementOperation =
  | 'OFFER_CREATED'
  | 'OFFER_ACCEPTED'
  | 'OFFER_DECLINED'
  | 'OFFER_EXPIRED';

export type AuditAnnouncementOperation =
  | UserAuditAnnouncementOperation
  | 'TEAM_DISBANDED'
  | 'TEAM_SWAPPED'
  | OfferAuditAnnouncementOperation;

export interface TeamDisbandDetails {
  endedMembershipCount: number;
  affectedUserCount: number;
  expiredOfferCount: number;
}

export interface UserAuditAnnouncementPlan {
  discordGuildId: string;
  channelId: string;
  operation: UserAuditAnnouncementOperation;
  actorDiscordUserId: string;
  playerDiscordUserId: string;
  teamIdentity: TeamIdentitySource;
  occurredAt: Date;
  staffRole?: StaffRoleCode;
  departureMode?: 'STAFF_ONLY' | 'FULL';
  presentation?: TransferAnnouncementPresentation;
}

export interface TeamDisbandAuditAnnouncementPlan {
  discordGuildId: string;
  channelId: string;
  operation: 'TEAM_DISBANDED';
  actorDiscordUserId: string;
  teamIdentity: TeamIdentitySource;
  occurredAt: Date;
  staffRole?: StaffRoleCode;
  departureMode?: 'STAFF_ONLY' | 'FULL';
  disbandDetails?: TeamDisbandDetails;
  presentation?: TransferAnnouncementPresentation;
}

export interface TeamSwapAuditAnnouncementPlan {
  discordGuildId: string;
  channelId: string;
  operation: 'TEAM_SWAPPED';
  actorDiscordUserId: string;
  team1Identity: TeamIdentitySource;
  team2Identity: TeamIdentitySource;
  occurredAt: Date;
  swapDetails: TeamSwapDetails;
  presentation?: TransferAnnouncementPresentation;
}

export interface OfferCreatedAuditAnnouncementPlan {
  discordGuildId: string;
  channelId: string;
  operation: 'OFFER_CREATED';
  actorDiscordUserId: string;
  playerDiscordUserId: string;
  teamIdentity: TeamIdentitySource;
  occurredAt: Date;
  expiresAt: Date;
}

export interface OfferAcceptedAuditAnnouncementPlan {
  discordGuildId: string;
  channelId: string;
  operation: 'OFFER_ACCEPTED';
  actorDiscordUserId: string;
  playerDiscordUserId: string;
  teamIdentity: TeamIdentitySource;
  occurredAt: Date;
  presentation?: TransferAnnouncementPresentation;
}

export interface OfferDeclinedAuditAnnouncementPlan {
  discordGuildId: string;
  channelId: string;
  operation: 'OFFER_DECLINED';
  actorDiscordUserId: string;
  playerDiscordUserId: string;
  teamIdentity: TeamIdentitySource;
  occurredAt: Date;
}

export interface OfferExpiredAuditAnnouncementPlan {
  discordGuildId: string;
  channelId: string;
  operation: 'OFFER_EXPIRED';
  playerDiscordUserId: string;
  teamIdentity: TeamIdentitySource;
  occurredAt: Date;
}

export type OfferAuditAnnouncementPlan =
  | OfferCreatedAuditAnnouncementPlan
  | OfferAcceptedAuditAnnouncementPlan
  | OfferDeclinedAuditAnnouncementPlan
  | OfferExpiredAuditAnnouncementPlan;

export type AuditAnnouncementPlan =
  | UserAuditAnnouncementPlan
  | TeamDisbandAuditAnnouncementPlan
  | TeamSwapAuditAnnouncementPlan
  | OfferAuditAnnouncementPlan;

export interface MutationPlans {
  roleMutation: MemberRoleMutationPlan;
  announcement: TransferAnnouncementPlan | null;
  auditAnnouncement?: AuditAnnouncementPlan | null;
}

export function toStaffRoleCode(staffType: StaffMembershipType): StaffRoleCode {
  switch (staffType) {
    case 'TEAM_MANAGER':
      return 'TM';
    case 'ASSISTANT_MANAGER':
      return 'ATM';
    case 'PLAYER_MANAGER':
      return 'PM';
  }
}

export function fromStaffRoleCode(role: StaffRoleCode): StaffMembershipType {
  switch (role) {
    case 'TM':
      return 'TEAM_MANAGER';
    case 'ATM':
      return 'ASSISTANT_MANAGER';
    case 'PM':
      return 'PLAYER_MANAGER';
  }
}

export function canReleaseStaffRole(
  actorRole: StaffRoleCode,
  targetRole: StaffRoleCode | null,
): boolean {
  if (targetRole === 'TM') return false;
  if (actorRole === 'TM') return true;
  if (actorRole === 'ATM') return targetRole === null || targetRole === 'PM';
  return targetRole === null;
}
