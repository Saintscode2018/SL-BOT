# SL Bot

SL Bot is a TypeScript Discord administration bot for the SL League. Stage 4A provides focused command subcommands, channel policy enforcement, squad limit management, public informational responses, and structured project brain documentation while retaining legacy Python implementation files and `superleague.db` as untouched references.

The database is authoritative. Discord roles are linked presentation and authorization objects; this stage never assigns or removes them automatically.

## Command tree

- `/setup`
  - `guild`: Set offer timeout for the server. (Ephemeral)
  - `channels`: Configure bot-commands, staff, transfer, and audit channels. (Ephemeral)
  - `roles`: Configure league admin, team manager, assistant manager, and player manager roles. (Ephemeral)
  - `view`: Display current server configuration and missing settings. (Ephemeral)
- `/team`
  - `add`: Register a new team linked to an existing role (inherits default squad limit). (Ephemeral)
  - `edit`: Update team name, short name, role, logo URL, or emoji. (Ephemeral)
  - `list`: List active teams, role mentions, player counts, effective limit, and remaining spaces. (**Public in bot-commands channel**)
- `/limit`
  - `default`: Set guild-wide default squad limit (1–100, default 17). (Ephemeral)
  - `team`: Set squad limit override for a specific club (1–100). (Ephemeral)
  - `reset`: Clear squad limit override for a specific club. (Ephemeral)
  - `view`: Display guild default and per-club overrides. (**Public in bot-commands channel**)
- `/staff`
  - `appoint`: Appoint a Team Manager, Assistant Manager, or Player Manager. (Ephemeral)
  - `remove`: Remove active holder of a staff position. (Ephemeral)
  - `list`: List active team staff (single team or all teams). (**Public in bot-commands channel**)
- `/roster`: Display team roster with active players, player count, effective limit, and remaining spaces. (**Public in bot-commands channel**)
- `/offer create`: Send a private DM contract offer card with persistent Sign Contract and Decline Offer buttons. (Ephemeral DM delivery)
- `/health`: Report bot and database status ephemerally in any channel. (Ephemeral)

Team inputs use database-backed autocomplete. Inactive teams are excluded and every selected internal club ID is revalidated during execution.

## Channel policy and response visibility

Commands are enforced via `CommandChannelPolicyService`:

- Public informational commands (`/team list`, `/staff list`, `/roster`, `/limit view`) execute only in the configured **Bot Commands Channel** and produce public responses.
- Administrative and mutation commands (`/setup *`, `/team add/edit`, `/limit default/team/reset`, `/offer create`, `/staff appoint/remove`) execute only in the configured **Staff Channel** and produce ephemeral responses.
- Ephemeral error messages guide users to the correct channel if triggered in an unauthorized channel.
- Channel policies apply strictly to all users; administrators cannot bypass channel policies.
- `/setup` subcommands can be bootstrapped in any channel prior to staff channel configuration.
- `/health` functions in any channel.

## Squad limit model

- Guild-wide default squad limit is **17**.
- Optional per-club override (`squadLimitOverride`).
- Effective limit = `squadLimitOverride ?? defaultSquadLimit`.
- Derived dynamically via domain helper `getEffectiveSquadLimit(club, settings)`.
- Staff appointments do not count toward player squad limits; staff members count as players only if they hold an active `PLAYER` membership.

## Architecture

The dependency direction is `bot -> services -> repositories -> Prisma`. Application construction creates one Prisma client, one Discord client, explicit services, static command/event registries, and typed interaction context. Command handlers contain no raw Prisma queries. Services and repositories do not import discord.js.

Every multi-write guild, team, staff, roster, offer, decline, and recovery workflow uses a Prisma transaction with an audit record. Squad capacity is derived from active `PLAYER` memberships and effective squad limits. Existing migration-level partial indexes, checks, and cross-guild foreign keys remain authoritative.

Offer buttons use deterministic IDs such as `offer:accept:<offer uuid>`. They contain no user, guild, or secret data and are dispatched globally through `interactionCreate`, so they continue working after a bot restart without in-memory collectors.

See [docs/architecture.md](docs/architecture.md) for transaction and failure semantics.

## Environment

Use Node.js 22.5 or newer within the Node.js 22 line. Copy `.env.example` to `.env`:

```dotenv
NODE_ENV=development
DATABASE_URL=file:./dev.db
LOG_LEVEL=info
DISCORD_TOKEN=
DISCORD_APPLICATION_ID=
DISCORD_DEVELOPMENT_GUILD_ID=
```

`DISCORD_TOKEN` is required only for bot startup, command deployment, or other Discord network work. Database tests and maintenance do not require a token. Application and development guild IDs are required only for guild command deployment. No league roles, channels, teams, or legacy snowflakes belong in the environment; `/setup` stores them in SQLite.

Normal application startup loads `.env` before validating runtime configuration. Values already supplied by the process environment take precedence. Tokens and complete environment objects are never written to application logs.

## First development startup

1. Install dependencies and generate Prisma:

   ```sh
   npm install
   npm run prisma:generate
   ```

2. Apply committed migrations to the development database:

   ```sh
   npm run prisma:migrate:deploy
   ```

3. Deploy the exact static registry to the development guild:

   ```sh
   npm run commands:deploy:guild
   ```

4. Start the bot:

   ```sh
   npm run dev
   ```

Command deployment is explicit and guild-scoped. Normal startup never deploys commands and the deployment script never starts the gateway client.

## Discord Developer Portal setup & Gateway Intents

Create or select an application, add its bot user, and reset/copy the bot token into `.env`. Copy the Application ID from General Information and the target server ID from Discord developer mode.

The bot requires only the non-privileged **`Guilds`** gateway intent (`GatewayIntentBits.Guilds`).
Leave **Server Members Intent** (`GuildMembers`) and **Message Content Intent** disabled.

In OAuth2 URL Generator select:

- scopes: `bot` and `applications.commands`
- bot permissions: View Channels, Send Messages, Embed Links, and Read Message History

Invite the bot to the development guild.

## Quality commands

```sh
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run build
npm test
```

Prisma migrations are the schema authority; do not substitute `prisma db push`.

## Current limitations

Stage 4A provides server configuration, command channel policies, and squad limit administration. It does not mutate Discord roles, announce transfers publicly in `transferChannelId`, publish live logs to `auditChannelId`, synchronize rosters from roles, import CSV files, schedule recurring expiration, manage fixtures/results/pickups/applications/lineups, provide monetization, or expose a web dashboard. Global command deployment is intentionally not included.
