---
title: SL Bot Architecture
type: architecture-docs
tags:
  - slbot
  - architecture
  - design
---

# SL Bot Architecture

Index: [[SLBot]]

## Layering Model

SL Bot strictly separates Discord interface concerns from domain rules and database transactions:

```
[Discord Gateway / REST]
           │
           ▼
[Interaction Handler & Command Definitions]
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

- **Bot Layer (`src/bot/`)**: Dispatches slash commands, autocomplete, and persistent button interactions. Ensures ephemeral responses for errors and mutations.
- **Service Layer (`src/services/`)**: Enforces business logic, authorization, squad capacity calculations, and Prisma transaction boundaries.
- **Repository Layer (`src/repositories/`)**: Encapsulates database queries and maps Prisma exceptions into standard domain errors (`EntityNotFoundError`, `SquadFullError`, `ValidationError`).
- **Domain Layer (`src/domain/`)**: Contains shared domain types, errors, validation schemas, and effective limit calculations.

## Database Authority Model

- The SQLite database is the **sole authoritative source of truth** for league state (clubs, staff appointments, active player memberships, pending contract offers, and transaction records).
- Discord server roles serve as presentation and access-control anchors.
- Manual edits to Discord server roles do **not** rewrite or override official database records.

## Transaction and Audit Semantics

Every state-changing administrative action (club creation, staff appointment, roster modification, contract offer, acceptance, decline, limit modification) is wrapped in a **Prisma database transaction** (`$transaction`).

Each transaction generates a corresponding `AuditEvent` row documenting:

- `actorUserId`: The identity performing the action.
- `eventType`: E.g., `guild.configured`, `club.created`, `roster.player_added`, `offer.created`, `limit.default_updated`.
- `beforeState` & `afterState`: JSON snapshots of state changes.

If audit logging or secondary database updates fail, the entire transaction rolls back cleanly.

## Channel Policy Architecture

`CommandChannelPolicyService` categorizes commands into three access levels:

1. **Public, Bot Commands Channel**: `/team list`, `/staff list`, `/roster`, `/limit view`.
2. **Staff Channel**: `/setup *`, `/team add`, `/team edit`, `/limit default`, `/limit team`, `/limit reset`, `/offer *`, `/staff appoint`, `/staff remove`.
3. **Any Channel**: `/health`.

Channel policies are checked prior to command execution. Wrong-channel execution returns an immediate ephemeral message guiding the user to the correct configured channel. Administrators are subject to channel policy constraints.

Related notes: [[Commands]], [[Product Decisions]], [[Testing and Deployment]]
