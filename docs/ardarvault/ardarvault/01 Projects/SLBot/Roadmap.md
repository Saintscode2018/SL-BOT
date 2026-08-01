---
title: SL Bot Roadmap
type: roadmap
tags:
  - slbot
  - roadmap
  - scope
---

# SL Bot Roadmap & Stage Boundaries

Index: [[SLBot]]

## Completed Stages

- **Stage 1 — TypeScript Foundation**: Database schema, SQLite migrations, repository primitives, Vitest integration harness.
- **Stage 2 — First Development-Guild MVP**: Basic bot initialization, `/health`, `/setup guild`, `/team create/list/deactivate`, `/staff appoint/remove/list`, `/roster add/remove/list`.
- **Stage 3 — Private Contract Offers & Acceptance**: Private DM offer creation, persistent button handling, DM delivery failure recovery, deterministic button custom IDs, offer expiration script.
- **Stage 4A — Setup Channels & Limits**: Split `/setup`, channel policies, squad limit management.
- **Stage 4A Hotfix — Permissions, Embeds, & Discord UX**:
  - Global bot permissions role (`bot_permissions` / `botPermissionsRoleId`) & Discord Administrator recovery.
  - Final channel policy matrix: Dual-channel (`bot_commands` or `staff`) vs Staff-only (`staff`).
  - Bootstrap exception for Discord Administrators before channel setup.
  - Embed-only response architecture for all successes and errors.
  - Subcommand rename: `/setup league`.
- **Stage 4A Polish — Errors, Branding, & Command UX**:
  - Specific domain conflict errors (duplicate role, name, short name, staff appointed, position occupied).
  - Global staff uniqueness rule (1 active staff position per user league-wide).
  - Guild-record custom emoji validation and composed Unicode emoji support.
  - Flattened `/offer player:<user>` command (auto-derives source team from caller's active database staff appointment).
  - Visual embed overhaul (`✅`/`❌` title prefixes, actor lines, vertical block fields for channels/roles).
  - Roster layout with author, standard team-label title, thumbnail, count, actual TM/ATM/PM names, divider, and players.
  - Development-only `/debugreset` command with confirmation flow.
- **Stage 4A Live-Test Corrections**:
  - Guild custom emoji resolution from full mentions, wrapped names, or plain names, plus composed Unicode regression coverage.
  - Default emoji-plus-role banners, safe `.examplept.` previews, and `.emojiName.` plain-text autocomplete fallback.
  - Correct TM/ATM/PM roster sections with no Assistant Coach placeholder.
  - Ephemeral administrative success matrix and authorization-aware channel guidance.
  - Setup/configuration Discord audit publishing for league, channels, roles, and team banners with nonfatal delivery failure.
  - Guild-specific `/bannerconfig` with fixed-order emoji/name/short/role components, emoji-plus-role defaults, and all-false rejection.
  - Shared team-banner formatting across normal output, safe text autocomplete, staff presentation, roster identity, offers, and relevant conflicts.
  - Vertical staff-directory blocks, affected-user appointment/removal wording, role-safe roster titles, setup-view preview, and best-effort banner audit publishing.
  - Compact `banner — current/max` team lists, normal-text staff banners, club-ID roster correlation, active-staff offer rejection, and ephemeral `Source Team` offer acknowledgements.

## Explicitly Excluded / Future Stages (Stage 4B+)

The following features are **explicitly excluded** from Stage 4A Polish and must not be implemented as placeholders:

- `/import` (Bulk CSV/JSON roster import)
- Discord Role Adapter & automatic role sync (`/sync`)
- Retry tables & background scheduling engine
- `/admin roster-add` and `/admin roster-remove`
- Public transfer announcements in `transferChannelId`
- Discord audit publishing for team, limit, staff, and debug-reset mutations
- `/demand`, `/release`, `/staff promote`, `/staff demote`
- Full `/team disband` workflow, `/team swap`, `/teamhealth`
- Match management (`/schedule`, `/gameresult`)
- Moderation, applications (`/apply`), fill requests (`/fofill`), customization (`/color`)

Related notes: [[Architecture]], [[Commands]], [[Session Log]]
