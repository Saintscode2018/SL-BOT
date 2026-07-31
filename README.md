# SL Bot

SL Bot is being rebuilt as a Discord bot for the SL League. The current branch contains a TypeScript Discord application foundation and transactional league services alongside the original Python implementation. It is not yet a complete league bot.

## Current status

This stage provides validated Discord startup, explicit command and event registration, database-backed guild configuration, and an atomic offer-acceptance service above the existing data foundation. The `/offer` command, views, embeds, buttons, announcements, and Discord role changes are intentionally not implemented.

The root-level Python files and `superleague.db` are legacy references. The TypeScript application does not import them, and the legacy database is never migrated or used by tests.

## Technology

- Node.js 22.5 or newer within the Node.js 22 LTS line and modern ECMAScript modules
- TypeScript with strict compiler checks
- Prisma ORM with SQLite
- Zod and dotenv for validated configuration
- Vitest, ESLint, and Prettier
- discord.js with the non-privileged `Guilds` intent

## Architecture

The dependency direction is `bot -> services -> repositories -> Prisma`. Application construction creates one Prisma client, one Discord client, repositories, services, static registries, and typed command context. Repository constructors accept either a `PrismaClient` or a caller-provided Prisma transaction client. Neither domain, service, nor repository modules import discord.js.

See [docs/architecture.md](docs/architecture.md) for entity relationships, transaction strategy, referential actions, and migration policy.

## Project structure

```text
src/app/             dependency construction and lifecycle
src/bot/             discord client registries and interaction handling
src/config/          environment validation
src/database/        prisma client construction
src/domain/          shared values errors and types
src/logging/         typed level aware logging
src/repositories/    injected database access
src/services/        guild configuration and league workflows
prisma/migrations/   reviewed versioned SQL
scripts/             read only legacy inspection
tests/               unit and integration tests
```

The Python files at the repository root are the unmodified legacy bot.

## Environment

Copy `.env.example` to `.env` and adjust local values. `DISCORD_TOKEN` is required when starting the application but remains optional for database tooling and tests.

```dotenv
NODE_ENV=development
DATABASE_URL=file:./dev.db
LOG_LEVEL=info
DISCORD_TOKEN=replace_with_a_real_token
```

Discord snowflakes and Roblox user IDs are stored as strings because their integer range can exceed JavaScript's safe integer range. Runtime snowflake input accepts decimal digits only.

## Setup and commands

Use Node.js 22.5 or newer within the Node.js 22 LTS line. The minimum is required because the read-only legacy inspector uses `node:sqlite`, which was introduced in Node.js 22.5.

```sh
npm install
npm run prisma:generate
npm run prisma:migrate:dev
npm run dev
```

The application entrypoint validates runtime configuration, connects Prisma, registers static events and command definitions, logs in one Discord client, and handles `SIGINT` and `SIGTERM`. Shutdown destroys Discord and disconnects Prisma exactly once. Startup failure cleans up partially opened resources without logging the token.

There are currently no public command definitions. Command metadata is not deployed automatically. The registry and interaction handler are ready for the next UI stage.

Quality commands:

```sh
npm run format:check
npm run lint
npm run typecheck
npm run build
npm test
```

Production-style migration and startup:

```sh
npm run prisma:migrate:deploy
npm run build
npm start
```

Prisma migrations are the schema authority. Tests apply real migrations to temporary file-backed databases; do not substitute `prisma db push`.

## Data model

- `Guild` has one optional `GuildSettings` record and owns clubs, memberships, offers, transactions, and audit events.
- `Club` is deactivated rather than deleted. Its name, short name, and Discord role are unique per guild.
- `LeagueUser` uses a Discord user ID as its durable external identity and can optionally store Roblox identity fields.
- `ClubMembership` preserves player and staff appointment history.
- `Offer` records a bounded pending offer and immutable terminal outcome.
- `LeagueTransaction` preserves league transaction history and optional reversal metadata.
- `AuditEvent` is append-only at repository level and stores JSON snapshots.

Squad size is not stored. It is always counted from active `PLAYER` memberships, preventing mutable counters from drifting away from roster truth.

SQLite partial unique indexes enforce one active player membership per guild, one holder of each restricted staff role per club, and one pending offer per club/player pair. Composite foreign keys require every membership, offer, and transaction club to belong to the row's guild. Check constraints enforce positive limits, valid offer expiry, and membership and offer status/timestamp consistency. These rules are kept in migration SQL because Prisma's schema language cannot express every conditional SQLite constraint.

## Services

`GuildConfigurationService` loads a configured guild, its settings, and active clubs by Discord guild snowflake. It never creates missing configuration or imports legacy IDs.

`OfferAcceptanceService` validates the accepting Discord identity, pending and expiry state, active destination club, derived squad capacity, and current player membership. Within one Prisma transaction it conditionally accepts the offer, ends a previous membership for transfers, creates the destination membership, records a signing or transfer, and appends an `offer.accepted` audit event. Expired offers are atomically marked `EXPIRED`. Concurrent acceptance allows only one completion.

## Legacy data

`superleague.db` is a tracked legacy database and must remain untouched. Inspect a legacy database read-only with:

```sh
npm run legacy:inspect -- superleague.db
```

The script lists tables, columns, and row counts without changing the file. The old database stores snowflakes as SQLite integers, stores a mutable roster count, and has a schema that differs from the new model. Importing it requires a separate reviewed migration task. No secrets or legacy identifiers are copied into `.env`.

## Next stage

The expected next stage is the `/offer` command and its Discord UI, followed by carefully coordinated role changes and announcements. Slash-command deployment, buttons, embeds, scheduling, applications, results, pickups, and production deployment remain future work.
