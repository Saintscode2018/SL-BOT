---
title: SL Bot Architecture
type: architecture-docs
tags:
  - slbot
  - architecture
  - design
---

# SL Bot Architecture (Stage 4A Polish Updated)

Index: [[SLBot]]

## Layering Model

SL Bot strictly separates Discord interface concerns from domain rules and database transactions:

```
[Discord Gateway / REST]
           │
           ▼
[Interaction Handler, Embed Builders & Command Definitions]
           │
           ▼
[Services & Authorization]
           │
           ▼
[Repositories & Domain Validation]
           │
           ▼
[Prisma Client & SQLite Engine]
```

- **Bot Layer (`src/bot/`)**: Dispatches slash commands, autocomplete, debug reset buttons, and persistent offer button interactions. It exposes bounded guild emoji records, builds standard Discord embeds, and owns the Discord setup-audit adapter. All errors and administrative successes are ephemeral; informational output and the successful offer acknowledgement retain their documented visibility.
- **Service Layer (`src/services/`)**: Enforces business logic, global bot permissions authorization, global staff uniqueness rules, pre-flight conflict resolution, squad capacity calculations, and Prisma transaction boundaries.
- **Repository Layer (`src/repositories/`)**: Encapsulates database queries and maps Prisma exceptions into standard domain errors (`DuplicateTeamRoleError`, `DuplicateTeamNameError`, `DuplicateTeamShortNameError`, `StaffAlreadyAppointedError`, `TeamPositionOccupiedError`, `EntityNotFoundError`, `SquadFullError`, `ValidationError`).
- **Domain Layer (`src/domain/`)**: Contains shared domain types, errors, validation schemas, and effective limit calculations.

## Database Authority Model

- The SQLite database is the **sole authoritative source of truth** for league state (clubs, staff appointments, active player memberships, pending contract offers, and transaction records).
- Discord server roles serve as presentation and access-control anchors.
- Manual edits to Discord server roles do **not** rewrite or override official database records.

## Authorization & Global Bot Permissions

`AuthorizationService` evaluates global bot administrative access:

- **Bot Permissions Role**: Granted via configured `bot_permissions` role (`botPermissionsRoleId`).
- **Discord Administrator Recovery**: Discord Administrator permission grants bootstrap setup and emergency recovery access.
- **Club Staff Authority**: `TEAM_MANAGER`, `ASSISTANT_MANAGER`, and `PLAYER_MANAGER` roles grant team offer authority, but DO NOT grant global setup or administrative permissions.

## Global Staff Uniqueness Architecture

- Users can hold only **one active club staff appointment across the entire league** (`getActiveStaffMembershipForUserInGuild`).
- Per-team position slots (TM, ATM, PM) permit at most one active holder (`getActiveStaffAppointment`).
- Pre-flight checks in `StaffManagementService.appoint` enforce both rules before transaction writes.

## Embed-Only Response System

- Every command output and error response is rendered as a Discord embed.
- Success titles begin with `✅`, error titles begin with `❌`.
- Reusable builders (`createSuccessEmbed`, `createInfoEmbed`, `createWarningEmbed`, `createErrorEmbed`) enforce standard styling and include actor fields (`Configured by`, `Added by`, `Appointed by`, `Removed by`).

## Channel Policy Architecture

`CommandChannelPolicyService` categorizes commands while accounting for caller authorization:

1. **Informational Commands**: `/health`, `/team list`, `/staff list`, `/roster`, and `/limit view`. Ordinary callers use Bot Commands; globally authorized callers may use Bot Commands or Staff.
2. **Team-Staff Command**: `/offer` accepts Bot Commands or Staff, checks channel guidance before active appointment resolution, and does not reveal Staff guidance to non-global callers in unrelated channels.
3. **Staff Channel Commands**: `/setup league`, `/setup channels`, `/setup roles`, `/setup view`, `/team add`, `/team edit`, `/team remove`, `/limit default`, `/limit team`, `/limit reset`, `/staff appoint`, `/staff remove`, `/debugreset`.

Bootstrap Exception: Before staff channel or `bot_permissions` role is configured, Discord Administrators may execute setup commands in the current channel.

## Branding, roster, visibility, and setup audit

- Custom team emoji input accepts full static/animated mentions, `:name:`, plain `name`, and composed Unicode sequences. Names require one exact case-insensitive match in the bounded guild emoji records; Discord IDs, names, and animation flags are canonicalized from the guild cache.
- Team display uses `<emoji> Name (SHORT)` everywhere, with a legacy `Name (SHORT)` fallback. Autocomplete uses `:name:` for custom emoji and stores the club ID.
- Roster sections use Team Manager, Assistant Team Manager, and Player Manager directly. The former Franchise Owner, General Manager, Head Coach, and Assistant Coach sections are absent.
- Successful setup, team, limit, staff, and debug-reset administrative responses are ephemeral. Setup view is ephemeral, informational lists and roster remain public, health remains ephemeral, and offer acknowledgement remains public.
- Successful setup league/channels/roles mutations publish a timestamped, actor-attributed embed through `SetupAuditService` when an audit channel exists. Channel setup publishes only after saving and uses the new channel. Delivery failure is logged without rollback. Other mutation publishing is deferred.

Related notes: [[Commands]], [[Product Decisions]], [[Testing and Deployment]]
