# Architecture

## Boundaries and construction

Discord adapters translate interactions into plain service inputs. Services own authorization, workflows, and transaction boundaries. Repositories own scoped persistence. Prisma and the Discord client are constructed once and injected; runtime registration is static.

```text
Discord commands, autocomplete, and buttons
                    |
                    v
       authorization/workflow services
           /                    \
 Discord role adapter       repositories
           |                    |
           v                    v
      Discord API         Prisma + SQLite
```

The gateway requests only `GatewayIntentBits.Guilds`. Startup connects Prisma, registers handlers, and logs in; partial startup cleans up both clients. Command deployment is an explicit REST operation and never runs during startup.

## Permanent team identity

`Club.id` is the stable database key. A rendered team has exactly two required components: `emoji` and `discordRoleId`. Discord supplies readable role names from the guild cache; none are persisted as team data. There is no team display name, abbreviation, or per-guild presentation configuration.

`formatTeamIdentity(team, mode)` is shared by team, staff, roster, limit, offer, conflict, and autocomplete output. It has four rendering-aware modes: `message` (`<emoji> <@&roleId>`), `title` (`<emoji> @RoleName`), `footer` (Unicode or `.customName.` plus `@RoleName`), and role-only `autocomplete` (`@RoleName`). Missing cached roles become `Team` in titles and `Unknown Team Role` in footers/autocomplete; raw role IDs are emitted only by message mode.

- Message mode emits canonical emoji plus `<@&roleId>`.
- Title/footer modes use readable cached role names and never raw role mentions.
- Autocomplete emits only `@CachedRoleName`; missing cache data becomes `Unknown Team Role`, never a raw ID.
- Choice values remain club IDs, inactive clubs are excluded, and execution revalidates club ID and guild.

`/team add` accepts required role and emoji only. `/team edit` accepts a club ID and at least one optional role/emoji change. The repository enforces role uniqueness across active and inactive clubs in the same guild. Name-based queries, validation, errors, and indexes do not exist.

## Schema and migration guarantees

The final corrective SQLite migration rebuilds `GuildSettings` without the former banner booleans and rebuilds `Club` without `name` or `shortName`. Stage 4B.1 adds a partial unique index over active TM/ATM/PM rows by guild and user. Together with the active-player and per-slot indexes, SQLite is the final concurrency guard for one roster and one staff appointment per user plus one holder per team slot.

Composite `Club(id, guildId)` references remain intact for memberships, offers, and source/destination transactions. Migration tests cover fresh deployment and a populated Stage 4A graph containing settings, an inactive club, player/staff memberships, an offer, a transaction, and an audit event, followed by `PRAGMA foreign_key_check`.

## Authorization and channel policy

Global authorization is granted to the guild owner, a Discord Administrator, or a member with `botPermissionsRoleId`. Active TM/ATM/PM database appointments provide club-scoped authority only.

- Informational: `/health`, `/team list`, `/staff list`, `/roster`, `/limit view`.
- Team staff: `/offer` in Bot Commands or Staff.
- Administrative: `/setup *`, `/team add|edit|remove`, `/limit default|team|reset`, `/staff appoint|remove` in Staff.
- Debug: `/debugreset`, Discord Administrator only and Staff-restricted once configured.

Administrative permission is checked before protected Staff-channel guidance is revealed. `/setup` allows Discord-Administrator bootstrap before Staff is configured. Unknown or stale commands receive a safe ephemeral rejection.

## Presentation

Mutations, health, setup view, offer acknowledgements, and errors are ephemeral. Informational team/staff/limit lists and rosters are public. The central error mapper hides unexpected internal details and retains specific role, emoji, staff, squad, offer, permission, channel, inactive-team, and missing-record errors.

Presentation logic is centralized under `src/bot/presentation/`:

- `emojis.ts`: Defines `BOT_EMOJIS` (canonical emoji mapping: `teamManager: '👑'`, `assistantTeamManager: '👔'`, `playerManager: '🧠'`, `botPermissions: '⚡'`, `roster: '📊'`, `expiry: '⏰'`, `success: '✅'`, `error: '❌'`, `warning: '⚠️'`).
- `labels.ts`: Defines `BOT_LABELS` (canonical label spelling & capitalization).
- `colors.ts`: Defines `BOT_COLORS` (`success`, `info`, `warning`, `error`, `neutral`) and `resolveTeamRoleColor`.
- `timestamps.ts`: Canonical timestamp formatters (`formatDiscordRelative`, `formatDiscordShortDateTime`, `formatDiscordLongDateTime`, `formatUtcFooterTimestamp`).
- `users.ts`: User mention & visible name formatters (`formatUserMention`, `formatUserWithVisibleName`, `formatUserFooterName`, `sanitizeInlineCode`).
- `roles.ts`: Bot-layer team identity presentation wrappers (`formatTeamMessageIdentity`, `formatTeamReadableTitle`, `formatTeamPlainRoleName`, `formatTeamFooterIdentity`, `formatTeamAutocompleteIdentity`).
- `blockquotes.ts`: Blockquote helpers (`formatBlockquote`, `blockquoteLine`).
- `authors.ts` & `footers.ts`: Standardized embed author (`createGuildAuthor`) and footer builders (`createActorFooter`, `createPlayerFooter`, `createTimestampedFooter`).

`/team list` renders one `identity — current/max` line per active team. Staff directories render one normal-text identity followed by vertical TM/ATM/PM lines and `Vacant` slots. Rosters have no title: the description begins `<emoji> <@&roleId> Roster`, allowing the role mention to render normally, and there is no separate `Team` field. Their footer is `Roster for <footer-safe identity>, <server name>`; custom emoji use `.name.` there. Thumbnails derive only from emoji.

Offer creation still derives the issuing/source team from the caller's active database staff appointment. Creation rejects signed targets. Acceptance transactionally rechecks pending status, target identity, expiry, active team, free-agent state, and current squad capacity. The live acceptance path adds only the destination team role before committing and publishes a signing announcement afterward; stale competing offers remain stored but cannot be accepted once the player is signed.

The Discord interaction adapter is the single role-metadata boundary and exposes cached `{ id, name, color }`. Single-team embeds use a nonzero role color directly; a missing/zero-color role keeps the existing embed fallback. The command resolves presentation metadata before private offer delivery, so the DM adapter never queries Discord. Role colors are not persisted and require no schema change.

## Roster mutation and Discord consistency

Staff is represented by an active `PLAYER` membership plus one active TM/ATM/PM appointment for the same guild and club. Staff-only departure/demotion ends only the appointment. Full departure/release ends both rows. The central mutation service revalidates state inside each transaction, writes end metadata, retains history, and returns discord.js-free role/announcement plans.

SQLite and Discord cannot share a transaction. The coordinator first performs a read-only database validation and builds a role plan, then the role adapter force-fetches a fresh member snapshot before validating member existence, Manage Roles permission, configured role existence, managed-role status, and hierarchy. This prevents stale cached role IDs from causing a required global-role removal to be skipped. It applies only missing additions and present removals. Staff-removal results preserve the prior rank so the plan removes the matching configured global TM/ATM/PM role without removing the team role. The database transaction repeats eligibility and commits second. If it fails, the synchronizer reverses only role operations it actually applied. Failed compensation is both logged with guild/user/role-purpose context and surfaced; manual reconciliation is the known limitation because Stage 4B.1 adds neither a queue nor a reconciliation command. No success or announcement occurs before both critical steps finish.

Manage Roles or Administrator is required, but Administrator does not bypass Discord hierarchy. The bot role must be above the target member's highest role and every role being added or removed, and the server owner is never manageable. Recommended order is `SL Bot role`, playable administrator roles, TM/ATM/PM, then team roles; an administrator may play only while their highest role is below the bot role.

Transfer Market is the movement-announcement boundary; Audit remains the configuration boundary. A Discord presentation provider resolves guild, role, actor, and subject names/icons into plain metadata; the message adapter performs no independent presentation lookup. Staff appointment/demotion messages are structured transaction embeds with server author/icon, team-role color, emoji thumbnail, readable team-role title without `@`, and a configured staff-role mention for appointments. Their administrative actor appears in the body and in a readable username/avatar/timestamp footer. Missing team-role metadata falls back to `Team Transaction` without exposing a raw role ID. Signing messages use `✅ Offer Accepted - RoleName`, an acceptance description, roster current/max, current TM, and a signed-player footer. Announcement delivery after a completed mutation is best effort and never reverses roster state. The in-memory confirmation registry uses random UUID tokens and server-side guild/action/team/target/initiator context, expires after two minutes, consumes atomically, supports cancel/expiry UI callbacks, and intentionally loses pending state on restart. Its confirmation execution callback is the boundary for fresh authorization and eligibility checks.

The inactive-club compatibility checks remain in current services and should be removed only in the later focused team-inactivation cleanup.

## Setup auditing

`GuildSetupService` owns league, channel, role, and read-only view operations. Successful setup mutations persist before `SetupAuditService` performs best-effort Discord publication. Channel setup uses the newly saved audit channel. Adapter failure is logged without rollback. Setup view has no team-identity settings section and never publishes. General mutation auditing remains out of scope.

## Squad limits

Effective capacity is `club.squadLimitOverride ?? settings.defaultSquadLimit`. Active `PLAYER` memberships count; because every staff member also owns that player row, TM/ATM/PM all consume squad capacity. Roster presentation derives all active members, active staff user IDs, and ordinary players: capacity uses the first collection while the Players field uses only the last, preventing duplicate staff display. Limit DTOs carry the `Club` record rather than duplicating presentation fields.

The command boundary resolves the source role name/color plus guild name/icon before private offer delivery. The DM adapter does not query a guild and renders a `Contract Offer` card with Source Team, Team Manager, `📊 Squad`, and relative-only `⏰ Expires` fields, followed by persistent buttons configured with ✅/❌ emoji. Missing role metadata becomes a safe readable `Team` identity rather than a raw ID or `@unknown-role`.
