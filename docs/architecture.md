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

The client requests only `GatewayIntentBits.Guilds`. `interactionCreate` dispatches chat-input commands, autocomplete, and offer buttons separately. Known errors pass through one safe error mapper; unexpected errors are logged internally and become a generic ephemeral response.

Command deployment is an explicit REST operation through `scripts/deploy-commands.ts`. It sends the registry JSON to `Routes.applicationGuildCommands` with validated application and development-guild IDs. It neither starts the gateway client nor runs during application startup.

## Command channel policy service

`CommandChannelPolicyService` classifies commands prior to execution:

- **Public, Bot Commands Channel**: `/team list`, `/staff list`, `/roster`, `/limit view`.
- **Staff Channel**: `/setup *`, `/team add`, `/team edit`, `/limit default`, `/limit team`, `/limit reset`, `/offer *`, `/staff appoint`, `/staff remove`.
- **Any Channel**: `/health`.

Validation rules:

1. Rejects execution in unauthorized channels before invoking domain mutations.
2. Formats ephemeral error messages specifying the exact target channel.
3. Allows `/setup` bootstrapping in any channel when `staffChannelId` is not yet configured.
4. Enforces channel rules strictly for all users without administrator bypass.

## Authorization

Commands extract a plain authorization input containing guild ID, user ID, owner ID, member role IDs, Administrator permission, and optional club context. `AuthorizationService` applies the policy centrally:

- setup requires the guild owner or Discord Administrator
- league administration accepts owner, Administrator, or the configured league-admin role
- team-scoped roster and offer actions additionally accept an active `TEAM_MANAGER`, `ASSISTANT_MANAGER`, or `PLAYER_MANAGER` membership for that club

Role IDs come from `GuildSettings`; staff authority comes from active database memberships. Discord default command permissions are not the sole authorization mechanism. Every club and authorization value is revalidated during execution.

## Squad limits and effective capacity

Squad capacity resolution uses a domain helper (`getEffectiveSquadLimit`):

- Guild default limit: `defaultSquadLimit` (default 17).
- Per-club override: `squadLimitOverride` (nullable integer).
- Effective limit: `squadLimitOverride ?? defaultSquadLimit`.

`LimitManagementService` allows league administrators to adjust default limits and club overrides via `/limit default`, `/limit team`, `/limit reset`, and `/limit view`. Capacity checks in `RosterManagementService`, `OfferCreationService`, and `OfferAcceptanceService` evaluate `playerCount >= effectiveLimit`.

Staff members do not count toward player squad limits unless they also hold an active `PLAYER` membership.

## Administration transactions

`GuildSetupService` manages `/setup` subcommands (`guild`, `channels`, `roles`, `view`) and appends audit events (`guild.configured`, `guild.channels_configured`, `guild.roles_configured`). `ClubManagementService` creates or edits clubs without deleting history. `StaffManagementService` creates and ends staff memberships while database partial indexes enforce one active holder per staff type. Bot users are rejected.

`RosterManagementService` performs player registration and removal atomically. Registration checks the guild-wide active player membership and derived destination capacity against the effective squad limit, then creates the membership, `SIGNING`, and audit. Removal ends the exact team membership and creates a `RELEASE` plus audit. Audit failure rolls back the other writes.

Squad counts always query active `PLAYER` memberships. No mutable roster counter exists. Cross-guild composite foreign keys and existing partial unique indexes remain the final concurrency guard.

## Teams and autocomplete

Teams link to existing Discord role IDs, but roles do not define roster truth. Team name, normalized uppercase short name, and role ID are unique per guild. Deactivation changes only `active`.

Autocomplete loads active clubs for the interaction guild, filters case-insensitively by name or short name, caps results at Discord's 25-choice limit, and returns internal club UUIDs. Execution performs a new guild-scoped active-club lookup and never trusts an autocomplete value by itself.

## Offers and persistent buttons

`OfferCreationService` authorizes the issuer, validates settings and destination state, creates or retrieves both users, checks current membership, derived capacity, and pending-offer uniqueness, then creates the offer and `offer.created` audit in one transaction. The configured timeout supplies expiration unless an internal override is provided.

`OfferDeliveryService` calls the pure creation workflow before using an injected message adapter. The Discord adapter opens the offered player's DM, sends a professional contract card, and returns the DM channel/message IDs for persistence. It does not fetch or post to the configured transfer channel. Services never receive a Discord client or interaction.

The contract card describes the league, destination club, optional club logo, player, offering manager, current squad count, effective squad limit, remaining places, current club, contract label, and Discord-formatted expiry. It uses no broad mentions. The persistent buttons are labeled Sign Contract and Decline Offer.

Button IDs are deterministic and validated:

```text
offer:accept:<offer uuid>
offer:decline:<offer uuid>
```

They fit Discord's custom-ID limit and contain no player, guild, token, or serialized state. Global dispatch reconstructs all behavior from the offer ID and database, so buttons survive restarts.

Before acceptance or decline, `OfferResponseService` verifies that the interaction channel and message match the saved DM channel and message IDs. A copied custom ID, a different DM, or an offer without a stored reference cannot change league state.

Acceptance uses the existing atomic service: it conditionally changes `PENDING` to `ACCEPTED`, ends a source membership for transfers, creates the destination membership, creates a signing/transfer, and appends audit state. The accepting player is the audit actor; the offer creator is the roster transaction initiator and performer.

`OfferDeclineService` conditionally changes `PENDING` to `DECLINED` and audits it without a membership or transaction. Accept and decline validate that the clicking Discord identity matches the offered player. Expired clicks atomically mark `EXPIRED`. Concurrent terminal responses permit only one success.

## Discord failure semantics

Discord messaging cannot participate in a SQLite transaction, so side effects have explicit recovery behavior:

- DM send failure transactionally changes the new offer to `VOIDED` and records exactly one `offer.delivery_failed`
- message-reference persistence failure attempts orphan cleanup and voids the offer
- acceptance or decline commits before terminal message editing
- terminal edit failure retains durable league state and records `offer.discord_message_update_failed`

The void transition and delivery-failure audit use repositories bound to the same Prisma transaction, so audit failure rolls the state change back. Cleanup and recovery failures are logged separately and preserved in a focused delivery error. The bot does not pretend to roll back committed league history because a Discord edit failed. A later repair tool can consume the recovery audits. The current `offers:expire` maintenance script handles database expiration and reports stored message references; no background scheduler exists yet.

`transferChannelId` remains the future public destination for completed signings, transfers, releases, demand releases, and other completed roster announcements. Pending offers never use it. `auditChannelId` is the future staff-facing log destination, while database `AuditEvent` records remain authoritative.

## Database guarantees and migration policy

SQLite migration SQL owns conditional checks Prisma cannot express. Partial unique indexes enforce one active player per guild, one active holder of each staff type per club, and one pending offer per club/player. Composite foreign keys prevent memberships, offers, and transactions from referencing a club in another guild. Status/timestamp checks preserve membership and offer state consistency.

All tests use committed migrations against fresh file-backed SQLite databases. Schema evolution requires versioned migrations; `prisma db push` is not part of the workflow. The tracked `superleague.db` and root Python files remain legacy-only and are not imported or modified.

## Deliberate stage boundaries

The current bot does not assign or remove Discord roles, publish transfer announcements in `transferChannelId`, publish live logs in `auditChannelId`, synchronize role membership, bulk import, manage competitions, or deploy commands globally. Those external side effects require their own reviewed stage and recovery model.
