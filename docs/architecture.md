# Architecture

## Boundaries and construction

Discord adapters translate interactions into plain service inputs. Services own authorization, workflows, and transaction boundaries. Repositories own scoped persistence operations. Prisma is constructed once and injected; there is no global service container, reflection, decorator loading, or runtime filesystem scan.

```text
discord commands events and adapters
                |
                v
authorization and workflow services
                |
                v
        injected repositories
                |
                v
          prisma and sqlite
```

Repositories and services store only strings, UUIDs, dates, domain values, and plain objects. They do not import discord.js. Discord snowflakes remain strings throughout the system.

## Lifecycle and registration

`createApplication` loads `.env`, preserves values already injected into the process environment, validates runtime configuration, and constructs one logger, Prisma client, Discord client, message adapter, services, static command registry, and static event registry. `Application.start` connects Prisma, registers the interaction event, and logs in. Partial startup failure destroys Discord and disconnects Prisma. `Application.stop` is idempotent and process signal handling shares one shutdown promise.

The client requests only `GatewayIntentBits.Guilds`. `interactionCreate` dispatches chat-input commands, autocomplete, and offer buttons separately. Known errors pass through one safe error mapper; unexpected errors are logged internally and produce a visible ephemeral error embed.

Command deployment is an explicit REST operation through `scripts/deploy-commands.ts`. It sends the registry JSON to `Routes.applicationGuildCommands` with validated application and development-guild IDs. It neither starts the gateway client nor runs during application startup.

## Command channel policy service

`CommandChannelPolicyService` classifies commands prior to execution:

- **Dual-Channel Commands** (Bot Commands Channel or Staff Channel): `/health`, `/team list`, `/staff list`, `/roster`, `/limit view`, `/offer create`.
- **Staff Channel Only**: `/setup league`, `/setup channels`, `/setup roles`, `/setup view`, `/team add`, `/team edit`, `/team remove`, `/limit default`, `/limit team`, `/limit reset`, `/staff appoint`, `/staff remove`.

Validation rules:

1. Rejects execution in unauthorized channels before invoking domain mutations.
2. Formats ephemeral error embeds specifying the exact allowed target channel(s).
3. Allows `/setup` bootstrapping in any channel when `staffChannelId` is not yet configured, strictly for users with Discord Administrator permissions.
4. Once `staffChannelId` is configured, `/setup` commands must be executed in the staff channel.

## Authorization and Global Bot Permissions

Commands extract a plain authorization input containing guild ID, user ID, owner ID, member role IDs, Administrator permission, and optional club context. `AuthorizationService` applies the policy centrally:

- **Global Bot Permissions**: Granted to users who hold the configured `bot_permissions` role (`botPermissionsRoleId`) OR have the Discord **Administrator** permission.
- **Discord Administrator Bootstrap/Recovery**: Discord Administrator permission grants bootstrap setup and emergency administrative recovery access.
- **Club Staff Scope**: Club staff positions (`TEAM_MANAGER`, `ASSISTANT_MANAGER`, `PLAYER_MANAGER`) permit managing offers for their specific team, but DO NOT grant global bot permissions or setup authority.

Role IDs come from `GuildSettings`; staff authority comes from active database memberships. Discord default command permissions are not the sole authorization mechanism. Every club and authorization value is revalidated during execution.

## Embed-Only Response System & Error Feedback

- Every command execution and error response is delivered as a Discord embed.
- Reusable embed builders (`createSuccessEmbed`, `createInfoEmbed`, `createWarningEmbed`, `createErrorEmbed`) enforce standard styling and color codes across all commands.
- Handled errors produce visible ephemeral embeds in Discord while preserving detailed stack traces in application logs.
- Unknown runtime errors map to a safe generic error embed without exposing stack traces to end users.

## Team Branding & Custom Emojis

- Teams support custom Discord emojis (`<:name:emojiId>` or `<a:name:emojiId>`).
- Emoji helper validates format and derives Discord CDN URLs (`https://cdn.discordapp.com/emojis/EMOJI_ID.png` or `.gif`).
- Single-team embeds (team add/edit confirmations, roster views, offer cards) use derived custom emoji CDN URLs as thumbnails.
- Multi-team lists display inline custom emoji mentions beside team names.

## Squad limits and effective capacity

Squad capacity resolution uses a domain helper (`getEffectiveSquadLimit`):

- Guild default limit: `defaultSquadLimit` (default 17).
- Per-club override: `squadLimitOverride` (nullable integer).
- Effective limit = `squadLimitOverride ?? defaultSquadLimit`.

`LimitManagementService` allows league administrators to adjust default limits and club overrides via `/limit default`, `/limit team`, `/limit reset`, and `/limit view`. Capacity checks in `RosterManagementService`, `OfferCreationService`, and `OfferAcceptanceService` evaluate `playerCount >= effectiveLimit`.

Staff members do not count toward player squad limits unless they also hold an active `PLAYER` membership.

## Administration transactions

`GuildSetupService` manages `/setup` subcommands (`league`, `channels`, `roles`, `view`) and appends audit events (`guild.configured`, `guild.channels_configured`, `guild.roles_configured`). `ClubManagementService` creates, edits, or deactivates clubs (`/team remove` performs a safe soft deactivation while preserving historical memberships, staff appointments, offers, transactions, and audit records, distinguishing it from the future complete `/disband` franchise shutdown workflow). `StaffManagementService` creates and ends staff memberships while database partial indexes enforce one active holder per staff type. Bot users are rejected.

`RosterManagementService` performs player registration and removal atomically. Registration checks the guild-wide active player membership and derived destination capacity against the effective squad limit, then creates the membership, `SIGNING`, and audit. Removal ends the exact team membership and creates a `RELEASE` plus audit. Audit failure rolls back the other writes.

Squad counts always query active `PLAYER` memberships. No mutable roster counter exists. Cross-guild composite foreign keys and existing partial unique indexes remain the final concurrency guard.

## Database guarantees and migration policy

SQLite migration SQL owns conditional checks Prisma cannot express. Partial unique indexes enforce one active player per guild, one active holder of each staff type per club, and one pending offer per club/player. Composite foreign keys prevent memberships, offers, and transactions from referencing a club in another guild. Status/timestamp checks preserve membership and offer state consistency.

Schema migrations track column renames safely (`botPermissionsRoleId`). All integration tests execute against fresh file-backed SQLite databases using actual migrations.
