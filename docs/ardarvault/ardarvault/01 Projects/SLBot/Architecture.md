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

- **Bot Layer (`src/bot/`)**: Dispatches slash commands, autocomplete, debug reset buttons, and persistent offer button interactions. Builds standard Discord embeds with `✅`/`❌` title prefixes using `embeds.ts` and handles server custom & Unicode emojis via `emoji-helper.ts`. Ensures ephemeral embed responses for all errors.
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

`CommandChannelPolicyService` categorizes commands into two access levels:

1. **Dual-Channel Commands**: `/health`, `/team list`, `/staff list`, `/roster`, `/limit view`, `/offer` (Allowed in Bot Commands OR Staff channel).
2. **Staff Channel Commands**: `/setup league`, `/setup channels`, `/setup roles`, `/setup view`, `/team add`, `/team edit`, `/team remove`, `/limit default`, `/limit team`, `/limit reset`, `/staff appoint`, `/staff remove`, `/debugreset` (Restricted to Staff channel).

Bootstrap Exception: Before staff channel or `bot_permissions` role is configured, Discord Administrators may execute setup commands in the current channel.

Related notes: [[Commands]], [[Product Decisions]], [[Testing and Deployment]]
