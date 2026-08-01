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
  - Option A custom emoji validation (checked against current guild emojis via `hasGuildEmoji`) + Unicode emoji support.
  - Flattened `/offer player:<user>` command (auto-derives destination team from caller's active staff appointment).
  - Visual embed overhaul (`✅`/`❌` title prefixes, actor lines, vertical block fields for channels/roles).
  - Reference roster layout (author, title, thumbnail, roster count, Franchise Owner, GM, Head Coach, Assistant Coach, Players).
  - Development-only `/debugreset` command with confirmation flow.

## Explicitly Excluded / Future Stages (Stage 4B+)

The following features are **explicitly excluded** from Stage 4A Polish and must not be implemented as placeholders:

- `/import` (Bulk CSV/JSON roster import)
- Discord Role Adapter & automatic role sync (`/sync`)
- Retry tables & background scheduling engine
- `/admin roster-add` and `/admin roster-remove`
- Public transfer announcements in `transferChannelId`
- Live audit-channel publishing in `auditChannelId`
- `/demand`, `/release`, `/staff promote`, `/staff demote`
- Full `/team disband` workflow, `/team swap`, `/teamhealth`
- Match management (`/schedule`, `/gameresult`)
- Moderation, applications (`/apply`), fill requests (`/fofill`), customization (`/color`)

Related notes: [[Architecture]], [[Commands]], [[Session Log]]
