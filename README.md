# SL Bot

SL Bot is a TypeScript Discord administration bot for the SL League. The current stage provides the first visible development-guild MVP while retaining the legacy Python implementation and tracked `superleague.db` as untouched references.

The database is authoritative. Discord roles are linked presentation and authorization objects; this stage never assigns or removes them automatically.

## Visible commands

- `/health` reports bot and database availability ephemerally.
- `/setup guild` creates or updates guild settings for the server owner or a Discord Administrator.
- `/team create`, `/team list`, and `/team deactivate` manage database teams linked to existing Discord roles.
- `/staff appoint`, `/staff remove`, and `/staff list` manage historical staff appointments.
- `/roster add`, `/roster remove`, and `/roster list` manage active players and signing/release history.
- `/offer create` posts a persistent offer with Accept and Decline buttons in the configured transfer channel.

Team inputs use database-backed autocomplete. Inactive teams are excluded and every selected internal club ID is revalidated during execution.

## Architecture

The dependency direction is `bot -> services -> repositories -> Prisma`. Application construction creates one Prisma client, one Discord client, explicit services, static command/event registries, and typed interaction context. Command handlers contain no raw Prisma queries. Services and repositories do not import discord.js.

Every multi-write guild, team, staff, roster, offer, decline, and recovery workflow uses a Prisma transaction with an audit record. Squad capacity is derived from active `PLAYER` memberships. Existing migration-level partial indexes, checks, and cross-guild foreign keys remain authoritative.

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

`DISCORD_TOKEN` is required only for bot startup, command deployment, or other Discord network work. Database tests and maintenance do not require a token. Application and development guild IDs are required only for guild command deployment. No league roles, channels, teams, or legacy snowflakes belong in the environment; `/setup guild` stores them in SQLite.

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

## Discord Developer Portal setup

Create or select an application, add its bot user, and reset/copy the bot token into `.env`. Copy the Application ID from General Information and the target server ID from Discord developer mode.

The bot requires only the non-privileged `Guilds` gateway intent. Leave Server Members Intent and Message Content Intent disabled.

In OAuth2 URL Generator select:

- scopes: `bot` and `applications.commands`
- bot permissions: View Channels, Send Messages, Embed Links, and Read Message History

Invite the bot to the development guild. Manage Roles is not needed because this stage does not synchronize Discord roles.

## Manual Discord walkthrough

Run these commands in order after deployment and startup:

1. `/health` — expect an ephemeral `SL Bot is online` response and `Database: connected`.
2. `/setup guild` — select existing transfer/audit channels and league/staff roles. Re-running updates the same settings row.
3. `/team create` — provide a name, short name, existing team role, and squad limit. The role is linked but not created or assigned.
4. `/staff appoint` — select the team, a non-bot Discord user, and a staff type.
5. `/roster add` — manually register an existing player, optionally with Roblox identity fields.
6. `/team list`, `/staff list`, or `/roster list` — verify derived active state.
7. `/offer create` — select a destination team and player. A neutral embed with Accept and Decline buttons appears in the configured transfer channel.
8. Click Accept as the offered player — expect disabled/removed controls, an accepted status, a new active membership, a `SIGNING` or `TRANSFER`, and an audit event.
9. Create another offer and click Decline — expect a declined status with no membership or league transaction.

Another user clicking the buttons receives a safe rejection. Expired offers become `EXPIRED`. Pending offers can also be expired without starting Discord:

```sh
npm run offers:expire
```

The script reports the count and any message references that may need UI cleanup. It does not run a scheduler.

## Inspecting development data

Stop the bot before copying or externally inspecting the SQLite file. Prisma Studio can inspect the configured development database:

```sh
npx prisma studio
```

Do not edit production-like history manually. Verify `ClubMembership`, `LeagueTransaction`, `Offer`, and `AuditEvent` rows after the walkthrough. Tests always use fresh temporary file-backed databases with committed migrations.

The tracked legacy database is read only to this rebuild. Inspect it without mutation using:

```sh
npm run legacy:inspect -- superleague.db
```

## Discord side-effect recovery

Offer creation and its initial audit commit before Discord delivery. If message sending fails, the offer is transitioned to `VOIDED` and a delivery-failure audit is recorded. If a message is sent but its IDs cannot be saved, the adapter attempts to delete or disable the orphan and makes the offer unusable.

Acceptance or decline commits in SQLite before the terminal Discord edit. If the edit fails, durable league state is retained and `offer.discord_message_update_failed` is recorded for repair. The bot never attempts a fake database rollback after a successful league transaction.

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

This is an administration MVP, not the complete league bot. It does not mutate Discord roles, announce transfers publicly, synchronize rosters from roles, import CSV files, schedule recurring expiration, manage fixtures/results/pickups/applications/lineups, provide monetization, or expose a web dashboard. Global command deployment is intentionally not included.
