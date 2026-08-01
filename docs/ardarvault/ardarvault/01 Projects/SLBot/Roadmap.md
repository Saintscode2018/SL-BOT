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
- Readable roster title/footer presentation with no separate `Team` field.
- Live Discord role colors for single-team embeds and private offer DMs, with safe zero/missing-color fallbacks and no color persistence.
- Ephemeral offer acknowledgement naming target, actor, and source team, with no public follow-up.
- Global staff uniqueness, per-position limits, active-staff offer rejection, and database-appointment offer source.
- Setup audit publication with nonfatal delivery failure; read-only unaudited setup view.
- Safe rejection of stale removed commands.

## Stage 4B+ only

- Discord role synchronization or role-derived offer source.
- Import tooling.
- Transfer changes or public transfer announcements.
- Release, demand, promote, or demote commands.
- General mutation Discord auditing.
- Retry queues, background scheduling, match management, moderation, applications, and cosmetic customization.

The permanent identity model will not regain per-team aliases or configurable formatting in future stages.

Related notes: [[Architecture]], [[Commands]], [[Product Decisions]]
