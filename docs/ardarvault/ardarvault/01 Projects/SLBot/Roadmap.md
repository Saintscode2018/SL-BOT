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

## Current Stage: Stage 4A — Setup Channels & Limits

- Split `/setup` into focused subcommands (`guild`, `channels`, `roles`, `view`).
- Bot-commands and staff-channel configuration and policy enforcement.
- Reusable `CommandChannelPolicyService` for channel restrictions.
- Public informational success vs ephemeral errors.
- Guild-wide default squad limit of 17 & optional per-club override (`squadLimitOverride`).
- Squad limit management via `/limit default`, `/limit team`, `/limit reset`, `/limit view`.
- Updated `/team add`, `/team edit`, `/team list`.
- Public `/roster team:<club>` and removal of public `/roster add/remove`.
- Public `/staff list`.
- Gateway intent review & documentation.
- Obsidian project brain notes creation.

## Explicitly Excluded / Future Stages

The following features are **explicitly excluded** from Stage 4A and must not be implemented as placeholders:

- `/import` (Bulk CSV/JSON roster import)
- Discord Role Adapter & automatic role sync (`/sync`)
- Retry tables & background scheduling engine
- `/admin roster-add` and `/admin roster-remove`
- Public transfer announcements in `transferChannelId`
- Live audit-channel publishing in `auditChannelId`
- `/demand`, `/release`, `/staff promote`, `/staff demote`
- `/team disband`, `/team swap`, `/teamhealth`
- Match management (`/schedule`, `/gameresult`)
- Moderation, applications (`/apply`), fill requests (`/fofill`), customization (`/color`)

Related notes: [[Architecture]], [[Commands]], [[Session Log]]
