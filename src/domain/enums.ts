import { z } from 'zod';

export const membershipTypes = [
  'PLAYER',
  'TEAM_MANAGER',
  'ASSISTANT_MANAGER',
  'PLAYER_MANAGER',
] as const;
export type MembershipType = (typeof membershipTypes)[number];
export const membershipTypeSchema = z.enum(membershipTypes);

export const membershipStatuses = ['ACTIVE', 'ENDED'] as const;
export type MembershipStatus = (typeof membershipStatuses)[number];
export const membershipStatusSchema = z.enum(membershipStatuses);

export const offerStatuses = [
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
  'VOIDED',
] as const;
export type OfferStatus = (typeof offerStatuses)[number];
export const offerStatusSchema = z.enum(offerStatuses);

export const terminalOfferStatuses = [
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'CANCELLED',
  'VOIDED',
] as const satisfies readonly OfferStatus[];
export type TerminalOfferStatus = (typeof terminalOfferStatuses)[number];
export const terminalOfferStatusSchema = z.enum(terminalOfferStatuses);

export const leagueTransactionTypes = [
  'SIGNING',
  'TRANSFER',
  'RELEASE',
  'DEMAND_RELEASE',
  'STAFF_APPOINTMENT',
  'STAFF_PROMOTION',
  'STAFF_DEMOTION',
  'TEAM_SWAP',
] as const;
export type LeagueTransactionType = (typeof leagueTransactionTypes)[number];
export const leagueTransactionTypeSchema = z.enum(leagueTransactionTypes);
