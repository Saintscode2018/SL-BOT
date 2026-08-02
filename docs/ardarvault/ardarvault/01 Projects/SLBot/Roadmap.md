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

## Stage 4B.2–4B.4 and later

- Public `/demand`, `/release`, `/promote`, `/demote`, and `/folist` commands using the foundation.
- Role-derived offer source.
- Import tooling.
- General mutation Discord auditing.
- Retry queues, background scheduling, match management, moderation, applications, and cosmetic customization.

The permanent identity model will not regain per-team aliases or configurable formatting in future stages.

Related notes: [[Architecture]], [[Commands]], [[Product Decisions]]
