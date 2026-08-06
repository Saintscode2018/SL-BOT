---
title: SL Bot Roadmap
type: roadmap
tags:
  - slbot
  - roadmap
  - stage4a
---

# SL Bot Roadmap and Stage Boundaries

## Completed Stage 4A

- Prisma/SQLite guild, settings, clubs, memberships, offers, transactions, and audits.
- Setup channels/roles/settings, channel-policy enforcement, global permissions, and effective squad limits.
- Required emoji + Discord-role team identity with shared message/title/footer/autocomplete formatter modes.
- Corrective migration removing obsolete club presentation columns/indexes and guild presentation settings while preserving related data.
- Final `/team add role emoji` and `/team edit team [role] [emoji]` command shapes.
- Club-ID autocomplete with role-only cached `@RoleName` labels, safe unknown-role fallback, and no emoji or raw IDs.
- Team/staff/roster/limit/offer identity-only presentation.
- Roster description identity and readable footer presentation with no title or separate `Team` field.
- Live Discord role colors for single-team embeds and private offer DMs, with safe zero/missing-color fallbacks and no color persistence.
- Ephemeral offer acknowledgement naming target, actor, and source team, with no public follow-up.
- Global staff uniqueness, per-position limits, active-staff offer rejection, and database-appointment offer source.
- Setup audit publication with nonfatal delivery failure; read-only unaudited setup view.
- Safe rejection of stale removed commands.

## Completed Stage 4B.1 foundation

- Transactional shared signing, appointment, staff-only/full departure, release, promotion, and demotion primitives.
- Staff-as-roster and database uniqueness invariants, including the active-staff partial unique index.
- Discord team/global-staff role feasibility, synchronization, partial-failure compensation, and precise errors.
- Two-minute in-memory ephemeral confirmation registry with atomic handling and fresh-check callback.
- Transfer Market announcement adapter and signed-only offer safety corrections.
- Focused live presentation correction: staff remain capacity-counted but appear once, `/staff remove` removes the prior global staff role only, and hierarchy guidance uses the production bot/admin/staff/team order with no owner or Administrator bypass.
- Structured Transfer Market staff Appointment/Demotion cards use role-name titles without `@`, actor-attributed bodies/footers, and force-refreshed live role removal. Accepted signings use `✅ Offer Accepted - TeamRole`, roster/TM lines, and a signed-player footer. Private `Contract Offer` DMs retain resolved readable team roles, server author/icon, four ordered fields, relative expiry, and ✅/❌ persistent-button emoji.
- Centralized presentation system foundation under `src/bot/presentation/` (`emojis.ts`, `labels.ts`, `colors.ts`, `timestamps.ts`, `users.ts`, `roles.ts`, `blockquotes.ts`, `authors.ts`, `footers.ts`) establishing unified `BOT_EMOJIS`, `BOT_LABELS`, `BOT_COLORS`, timestamp helpers, and embed author/footer builders; global cosmetic pass is deferred.

## Completed Stage 4B.2 demand and release

- Registered exact `/demand` and `/release player` command shapes.
- Finalized subcommand-aware channel scopes: non-admin/team-user and informational commands (including demand/release/offer) use Bot Commands or Staff, while admin/configuration mutations use Staff only; Transfer Market and Audit are output-only.
- Corrected demand anti-spam to a fixed one-minute in-memory guild/user expiry: rejected retries do not slide it and wrong-channel attempts do not consume it. Two-minute rank-bound initiating-user confirmations remain unchanged.
- Added ordinary versus ATM/PM demand choices, TM restriction, staff-only step-down, full self-departure, own-team release hierarchy, no self/TM release, and no target confirmation or DM.
- Reused forced Discord role feasibility, role-first/database-second mutation, exact compensation, historical membership ending, and Transfer Market-only best-effort announcement routing.
- Completed `📣 Demand - TeamRole` two-line and `🚪 Release - TeamRole` three-line blockquote cards with safe `Team` fallback, post-roster/current-TM data, no stray quote line, and non-manager release attribution; staff-only demand reuses the structured Demotion card.
- Added no schema change or migration.

## Completed Stage 4B.3 promote and demote

- Registered exact `/promote player rank` and `/demote staff` command shapes.
- Enforced TM and ATM authorization for promotion; TM authorization for demotion. Blocked Discord Administrators and Bot Permission holders without an active staff appointment (no administrative bypass).
- Validated exact promotion paths (TM: Player -> PM, Player -> ATM, PM -> ATM; ATM: Player -> PM) and demotion paths (TM: ATM/PM -> Player).
- Rejected self-action, free agents, other-team members, TM targets, occupied destination slots (`StaffSlotOccupiedError`), and targets already at the desired rank.
- Applied 2-minute initiator-only ephemeral confirmation dialogs (`promotion-demotion-confirm:*`) with confirmation-time state re-checks.
- Retained roster membership, team role, and roster count while synchronizing global staff roles (`TM`, `ATM`, `PM`) and preserving historical staff appointments.
- Published structured Transfer Market cards (`⬆️ Promotion - TeamRole` / `⬇️ Demotion - TeamRole`) with server author/icon, team color/thumbnail, single blockquote panel, roster line, TM line, actor footer with avatar and UTC timestamp. No Audit channel delivery.
- Enforced `BOT_OR_STAFF` channel policy.

## Completed Stage 4B.4 and Stage 4C.1

- Completed `/teamhealth [team]`: Staff-only/global-admin-only read-only compact and detailed roster health, exact heart boundaries, effective limit/staff detail, cold-cache Discord resolution, deterministic chunking, and focused unit/integration coverage.
- Completed `/folist`: Staff-only/global-admin-only read-only compact team manager list (`<emoji> <role mention> Team Manager: <manager or Vacant>`), cold-cache Discord resolution, deterministic chunking, and focused unit/integration coverage.

## Completed Stage 4C.2 team disbandment

- Replaced public `/team remove` with exact `/team disband team:<team>` registration: required active-team autocomplete, no reason option, global-admin-only, Staff Commands-only, ephemeral, and initiator-confirmed.
- Ended every active player/staff membership and moved all affected users to free agency without deleting team, user, membership, offer, transaction, or audit history.
- Removed the team-specific role from every affected member and matching configured TM/ATM/PM roles from staff; ordinary players have no global Player role and retain unrelated roles.
- Expired only related pending offers, preserved terminal/unrelated offers, marked the team inactive, and wrote actor/count/timestamp `team.disbanded` audit metadata while preserving the Discord team role and emoji.
- Extended the existing role-first coordinator to deduplicated multi-member batches with reverse compensation for later-member or database failures and visible compensation-failure logging.
- Added command, authorization/channel, confirmation, database/history/offer/audit, role-plan, and compensation coverage. No Prisma schema or migration change was required.

## Later

- Role-derived offer source.
- Import tooling.
- General mutation Discord auditing.
- Retry queues, background scheduling, match management, moderation, applications, and cosmetic customization.

The permanent identity model will not regain per-team aliases or configurable formatting in future stages.

Related notes: [[Architecture]], [[Commands]], [[Product Decisions]]
