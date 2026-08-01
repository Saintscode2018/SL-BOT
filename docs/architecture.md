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

`createApplication` loads `.env`, preserves values already injected into the process environment, validates runtime configuration, and constructs one logger, Prisma client, Discord client, offer-message adapter, setup-audit adapter, services, static command registry, and static event registry. `Application.start` connects Prisma, registers the interaction event, and logs in. Partial startup failure destroys Discord and disconnects Prisma. `Application.stop` is idempotent and process signal handling shares one shutdown promise.

The client requests only `GatewayIntentBits.Guilds`. `interactionCreate` dispatches chat-input commands, autocomplete, and offer buttons separately. Known errors pass through one safe error mapper; unexpected errors are logged internally and produce a visible ephemeral error embed.

Command deployment is an explicit REST operation through `scripts/deploy-commands.ts`. It sends the registry JSON to `Routes.applicationGuildCommands` with validated application and development-guild IDs. It neither starts the gateway client nor runs during application startup.

## Command channel policy service

`CommandChannelPolicyService` classifies commands prior to execution:

- **Informational Commands**: Ordinary callers use Bot Commands; globally authorized callers may use Bot Commands or Staff. This category contains `/health`, `/team list`, `/staff list`, `/roster`, and `/limit view`.
- **Team-Staff Command**: `/offer` accepts Bot Commands or Staff, evaluates wrong-channel guidance before the caller's active staff appointment, and reveals the staff-channel option only to globally authorized callers on an unrelated channel.
- **Staff Channel Only**: `/setup league`, `/setup channels`, `/setup roles`, `/setup view`, `/bannerconfig`, `/team add`, `/team edit`, `/team remove`, `/limit default`, `/limit team`, `/limit reset`, `/staff appoint`, `/staff remove`, `/debugreset`.

Validation rules:

1. For administrative commands, verifies global permission before evaluating or revealing staff-channel guidance.
2. For informational commands, resolves global authorization before choosing bot-only or bot-and-staff guidance.
3. For `/offer`, validates the channel before the active TM/ATM/PM appointment is resolved.
4. Emits structured policy errors that the central mapper converts into exact ephemeral embeds.
5. Allows `/setup` bootstrapping in any channel when `staffChannelId` is not yet configured, strictly for users with Discord Administrator permissions.
6. Once `staffChannelId` is configured, `/setup` commands must be executed in the staff channel.

## Authorization and Global Bot Permissions

Commands extract a plain authorization input containing guild ID, user ID, owner ID, member role IDs, Administrator permission, and optional club context. `AuthorizationService` applies the policy centrally:

- **Global Bot Permissions**: Granted to users who hold the configured `bot_permissions` role (`botPermissionsRoleId`) OR have the Discord **Administrator** permission.
- **Discord Administrator Bootstrap/Recovery**: Discord Administrator permission grants bootstrap setup and emergency administrative recovery access.
- **Club Staff Scope**: Club staff positions (`TEAM_MANAGER`, `ASSISTANT_MANAGER`, `PLAYER_MANAGER`) permit managing contract offers for their team, but DO NOT grant global bot permissions or setup authority.

Role IDs come from `GuildSettings`; staff authority comes from active database memberships. Discord default command permissions are not the sole authorization mechanism. Every club and authorization value is revalidated during execution.

## Global Staff Uniqueness & Pre-flight Conflict Checks

- **League-wide Staff Uniqueness**: A user may hold only **one active club staff appointment across the entire league** (guild). A user cannot simultaneously hold TM, ATM, or PM roles on multiple teams. Attempting to appoint an already-appointed user throws `StaffAlreadyAppointedError` before database writes.
- **Per-team Position Limits**: Each team can have at most one active holder for each staff position (`TEAM_MANAGER`, `ASSISTANT_MANAGER`, `PLAYER_MANAGER`). Attempting to appoint a second holder throws `TeamPositionOccupiedError`.
- **Team Domain Conflicts**: Duplicate team role, name, or short name attempts trigger `DuplicateTeamRoleError`, `DuplicateTeamNameError`, or `DuplicateTeamShortNameError`, producing ephemeral red error embeds with specific conflict details.

## Embed-Only Response System & Error Feedback

- Every command execution and error response is delivered as a Discord embed.
- Embed titles automatically feature `✅` for successful administrative mutations and `❌` for error responses.
- Reusable embed builders (`createSuccessEmbed`, `createInfoEmbed`, `createWarningEmbed`, `createErrorEmbed`) enforce standard styling and color codes.
- Mutation embeds conclude with a full-width actor line (`Configured by`, `Added by`, `Appointed by`, `Removed by`).
- Handled errors produce visible ephemeral red embeds in Discord detailing specific domain conflicts without exposing database IDs or stack traces.
- Successful administrative setup, team, limit, staff, debug-reset, and offer acknowledgement output is ephemeral; `/setup view` is ephemeral as administrative configuration output. Informational list/roster output stays public, health stays ephemeral, and the target contract DM stays private.

## Team Branding, Custom & Unicode Emojis

- `/team add` requires a team emoji; `/team edit` permits optional emoji updates.
- Supports full custom mentions, wrapped names (`:name:`), plain names, and composed Unicode emoji sequences.
- `CommandInteraction.getGuildEmojis()` exposes only `{id, name, animated}` records. Full mentions resolve by guild ID and names resolve by one exact case-insensitive guild-cache match; the guild record determines the canonical mention and PNG/GIF CDN URL.
- `GuildSettings` stores four non-null banner switches. Defaults are emoji `true`, name `false`, short `false`, and role `true`. `/bannerconfig` updates them together and rejects an all-false configuration without writing or auditing. `/bannerconfig`, `/setup view`, and banner audit previews use the fictional `.examplept. Example Preview Team (EPT) @ExamplePreviewTeam` components and respect the saved switches.
- `formatTeamBanner` is the single fixed-order formatter for team identity. Embed mode uses canonical custom emoji and `<@&roleId>` mentions; autocomplete labels are plain text, so the mode uses Unicode or intentional `.emojiName.` text plus cache-derived `@RoleName`, omits unresolved roles, never exposes raw IDs or custom mentions, retains club IDs as choice values, and enforces the 100-character choice-name limit without splitting grapheme clusters.
- Team, limit, staff, roster, offer acknowledgement, private offer DM, and relevant conflict output use the shared formatter. Team lists use `banner — current/max`. Staff directories put banners in normal field value text rather than visually bold field headings, then use vertical TM/ATM/PM lines and chunk fields within Discord embed limits.
- Roster titles use enabled emoji/name components without role mentions. The full configured banner appears beneath the title only when it adds short-name or role information, avoiding redundant presentation.
- Single-team embeds (team add/edit confirmations, roster views, offer cards) use derived custom emoji CDN or Twemoji URLs as thumbnails.
- Multi-team list embeds display team emojis inline beside team names.

## Squad limits and effective capacity

Squad capacity resolution uses a domain helper (`getEffectiveSquadLimit`):

- Guild default limit: `defaultSquadLimit` (default 17).
- Per-club override: `squadLimitOverride` (nullable integer).
- Effective limit = `squadLimitOverride ?? defaultSquadLimit`.

`LimitManagementService` allows league administrators to adjust default limits and club overrides via `/limit default`, `/limit team`, `/limit reset`, and `/limit view`. Capacity checks in `RosterManagementService`, `OfferCreationService`, and `OfferAcceptanceService` evaluate `playerCount >= effectiveLimit`.

Staff members do not count toward player squad limits unless they also hold an active `PLAYER` membership.

## Administration transactions

`GuildSetupService` manages `/setup` subcommands (`league`, `channels`, `roles`, `view`) and the `/bannerconfig` settings mutation. Banner changes are authorized and validated before a transactional four-field update, with database audit before/after state. After successful setup or banner mutations, `SetupAuditService` calls one Discord adapter to publish a timestamped embed to the configured audit channel. Channel setup saves before publishing and uses the newly saved audit channel. Delivery failure is logged and does not roll back persistence. Setup view never publishes, and Discord publishing for team, limit, staff, and debug-reset mutations remains deferred.

`ClubManagementService` creates, edits, or deactivates clubs (`/team remove` performs a safe soft deactivation while preserving historical memberships, staff appointments, offers, transactions, and audit records). `StaffManagementService` creates and ends staff memberships with pre-flight uniqueness checks. Roster presentation uses the actual Team Manager, Assistant Team Manager, and Player Manager names and does not synthesize an Assistant Coach section.

`RosterManagementService` performs player registration and removal atomically. Registration checks the guild-wide active player membership and derived destination capacity against the effective squad limit, creating the membership, `SIGNING`, and audit. Roster reads consume the selected autocomplete value strictly as a club ID, scope the lookup to the current guild, and load the active club, players, and staff in one transaction. Missing and inactive clubs produce distinct domain errors.

`/offer player:<user>` automatically derives the source team from the caller's active database staff appointment. Discord-role scanning and synchronization are deferred. Callers without an active staff position are rejected ephemerally. Before creating an offer or audit, the creation transaction rejects targets with any active TM, ATM, or PM appointment in the guild; removed former staff become eligible again. Success edits the original ephemeral reply with `Source Team`, while the private offer DM and persistent buttons retain their existing delivery contract.

## Database guarantees and migration policy

SQLite migration SQL owns conditional checks Prisma cannot express. The original team-banner migration remains immutable. A corrective table-rebuild migration changes only future name and short-name defaults to false while copying every existing saved banner choice and unrelated setting unchanged. Fresh settings therefore default to emoji plus role without rewriting deployed migration history. Partial unique indexes enforce one active player per guild, one active holder of each staff type per club, and one pending offer per club/player. Composite foreign keys prevent memberships, offers, and transactions from referencing a club in another guild. Status/timestamp checks preserve membership and offer state consistency.

All integration tests execute against fresh file-backed SQLite databases using actual migrations.
