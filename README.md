# SL Bot

SL Bot is a TypeScript Discord administration bot for the SL League. The database is authoritative for stable internal records; Discord supplies readable role names and renders team role mentions. Legacy Python files and `superleague.db` remain untouched references.

## Team identity

A team is identified only by its required emoji and required Discord role:

```text
<emoji> <@&ROLE_ID>
```

There is no team display name, abbreviation, or configurable banner. `Club.id` remains the stable database identity used by commands and relations. The final schema keeps the club guild, Discord role, emoji, active state, squad-limit override, timestamps, and historical relationships. Roster and staff mutations use the centralized Discord role synchronizer.

`formatTeamIdentity(team, mode)` is the only presentation formatter, with separate modes for Discord rendering contexts:

- `message`: Unicode/custom emoji and `<@&roleId>` are preserved for normal embed/message bodies.
- `title`: `<emoji> @RoleName`, with `<emoji> Team` when the role cache cannot resolve the role.
- `footer`: Unicode stays readable, custom emoji become `.name.`, and the role becomes `@RoleName` or `Unknown Team Role`.
- `autocomplete`: only `@RoleName`, or `Unknown Team Role`; no emoji, mentions, or raw IDs.
- Autocomplete choice values remain immutable internal club IDs and role-only labels remain within Discord's 100-character limit.

## Command tree

- `/setup league|channels|roles|view`: Configure or inspect league settings. `/setup botperm add|remove|view` and `/setup botpermadmin add|view` manage guild-scoped database authorization; there is intentionally no admin-removal command. All responses are ephemeral. Permission mutations write DB audit events and publish best-effort Discord Audit messages; permission views are read-only and unaudited.
- `/data import`: Staff Commands-only initial migration that scans guild members once and additively imports missing active team/player or TM/ATM/PM memberships from registered Discord roles. It requires database `BOTPERM`/`BOTPERM_ADMIN`, complete channel and management-role setup, and at least one active registered team. Ambiguous roles, conflicts, and squad overflow are skipped and reported; reruns are idempotent. The operation creates one aggregate database audit event and at most one Discord Audit message, with no Transfer Market activity.
- `/team add role:<role> emoji:<emoji>`: Add a team. Both options are required.
- `/team edit team:<club> [role:<role>] [emoji:<emoji>]`: Edit a role and/or emoji. Supplying neither change is rejected.
- `/team disband team:<club>`: Admin-only, Staff Commands-only permanent league disbandment with an initiator-owned two-minute confirmation. It ends all active memberships, makes every member a free agent, removes the team role plus applicable TM/ATM/PM roles, expires related pending offers, and marks the team inactive while preserving its Discord role, emoji, database row, and all history. No reason is required. The former `/team remove` slash subcommand is no longer registered.
- `/team list`: Ephemeral `identity — current/max` lines, private to the invoking user.
- `/limit default|team|reset|view`: Manage the guild default and team overrides; team output uses only the shared identity. The read-only `view` response is ephemeral and private to the invoking user.
- `/staff appoint|remove|list`: Manage TM, ATM, and PM appointments. Appointment also ensures an active player roster row; staff-only removal retains that row and the team role while removing the matching configured global staff role. Ephemeral lists use vertical per-team blocks and `Vacant`.
- `/roster view team:<club>`: Ephemeral roster private to the invoking user whose description begins `<emoji> <@&RoleId> Roster`, with no title or separate `Team` field, followed by effective squad count, TM/ATM/PM fields, and players. Active staff count toward capacity but appear only in their staff field, never again under ordinary Players. Its footer is `Roster for <footer-safe team identity>, <server name>`. The former standalone `/roster team:<club>` form is no longer registered.
- `/roster add player:<user> team:<club>` and `/roster remove player:<user>`: Staff Commands-only administrative mutations for database `BOTPERM`/`BOTPERM_ADMIN` holders. Add accepts only non-bot free agents with no active staff appointment, targets active teams only, and enforces the destination's effective squad limit. Remove derives the player's one active team, rejects free agents, staff, and ambiguous roster data, and ends only the ordinary `PLAYER` membership.
- `/teamhealth [team:<club>]`: Ephemeral, read-only global-administration view in Staff Commands. Without `team`, it lists every active team as `<emoji> <role mention>: <active players> 👤, <heart>` and chunks complete rows across embeds. With `team`, it shows TM/ATM/PM (or `Vacant`), active roster count/effective limit, and health in one continuous blockquote.
- `/folist`: Ephemeral, read-only global-administration view in Staff Commands. It lists every active team and its Team Manager (`<emoji> <role mention> Team Manager: <formatted manager or Vacant>`), chunking complete rows across embeds with title `Franchise Owner List`.
- `/offer player:<user>`: Send a private contract offer for the team derived from the caller's active database staff appointment. Only free agents can receive or accept one. Acceptance adds the team role and publishes the completed signing to Transfer Market.
- `/demand`: Leave the caller's current team. Ordinary players may leave completely; ATM/PM callers may instead leave only their staff position and remain on the roster. TM callers are blocked.
- `/release player:<user>`: TM/ATM/PM callers may release a lower-ranked member of their own team. The target never confirms and receives no DM.
- `/promote player:<user> rank:<Assistant Team Manager|Player Manager>`: TM and ATM callers may promote team members. TM callers may promote Player -> PM, Player -> ATM, or PM -> ATM. ATM callers may promote Player -> PM only.
- `/demote staff:<user>`: TM callers may demote ATM or PM staff members back to ordinary players.
- `/health`: Ephemeral bot/database health.
- `/debugreset`: Development-only, database Bot Permission reset flow when `SLBOT_ENABLE_DEBUG_COMMANDS=true`; permission records are preserved to prevent lockout.

`/bannerconfig` has been removed. A stale cached interaction is rejected with a safe ephemeral response.

## Authorization, channels, and visibility

Global administration requires a guild-scoped database `BOTPERM` or `BOTPERM_ADMIN` record. Server ownership, Discord Administrator permission, and the legacy configured `bot_permissions` role do not grant global access. While a guild has zero permission records, a Discord Administrator may run the initial `/setup league`, `/setup channels`, and first `/setup botperm add`; that bootstrap ends immediately after the first record. TM/ATM/PM appointments retain only their intentional club-scoped operations.

`/data import` has no bootstrap exception: owners, Discord Administrators, the legacy Bot Permissions role, and TM/ATM/PM roles are denied unless the caller has a database Bot Permission.

## Discord gateway intents

The client requests `GatewayIntentBits.Guilds` and `GatewayIntentBits.GuildMembers`. Production deployment must enable **Discord Developer Portal → Bot → Privileged Gateway Intents → Server Members Intent**. Message Content and Presence intents are not requested.

- Non-administrative and informational `/health`, `/team list`, `/staff list`, `/roster view`, `/limit view`, `/offer`, `/demand`, and `/release` may be invoked only in the configured Bot Commands or Staff Commands channel. `/roster add` and `/roster remove` are administrative and require Staff Commands. Command-specific authorization still applies. Non-global callers (including ordinary players and TM/ATM/PM callers without global administrative authorization) see channel guidance mentioning only Bot Commands (`Use this command in <#botCommandsChannelId>.`); Staff Commands is never disclosed to non-global callers.
- `/offer` is allowed in Bot Commands or Staff and checks channel policy before resolving the caller's database appointment.
- `/demand` is ephemeral and uses a fixed one-minute in-memory guild/user cooldown. A permitted first attempt starts the window; blocked retries report the decreasing remainder without extending it, and wrong-channel attempts neither start nor refresh it.
- `/release` is ephemeral and allowed only in Bot Commands or Staff. Database staff authority—not global bot permission or Discord Administrator—controls access.
- `/setup *` (including view after setup), `/team add|edit|disband`, `/limit default|team|reset`, `/staff appoint|remove`, `/teamhealth`, `/folist`, and `/debugreset` are Staff-only except the database-permission views, which may also use Bot Commands. `/team disband`, `/teamhealth`, `/folist`, and `/debugreset` accept only database `BOTPERM`/`BOTPERM_ADMIN` holders—not owners, Discord Administrators, the legacy role, ordinary team staff, or players. Unauthorized callers receive `Permission Denied` without channel guidance. Authorized callers in wrong channels see concise guidance (`Use this command in <#staffCommandsChannelId>.`).
- Transfer Market and Audit are output-only for bot operations: completed roster movement is published to Transfer Market and configuration events to Audit, but slash commands are rejected there.
- Successful mutations, offer acknowledgements, all read-only/reporting responses (`/health`, `/setup view`, `/team list`, `/limit view`, `/staff list`, `/roster view`, `/teamhealth`, and `/folist`), and all handled errors are ephemeral and private to the invoking user.
- Setup league/channels/roles and Bot Permission mutations publish timestamped actor-attributed audit embeds when configured. Bot Permission mutations never publish to Transfer Market. Player and staff movements use Transfer Market instead; announcement failure is logged but does not roll back completed state.

## Stage 4B.1 movement foundation

`RosterMutationService` is the shared transaction boundary for signing, appointment, staff-only departure, full departure/release, promotion, and demotion. It re-reads guild/team/member/staff state in the commit transaction, preserves ended history and the previous staff rank, records actors, enforces squad and staff-slot limits, and returns plain role and announcement plans. Every active TM/ATM/PM therefore also has an active `PLAYER` membership on the same team. One active player row and one active staff row per user are enforced per guild; each staff slot remains unique per team. `/staff remove` uses the preserved rank to remove only the configured TM/ATM/PM role, leaving the active player membership and team role intact.

`RosterAdministrationService` coordinates `/roster add` and `/roster remove`. Players are represented by an active `PLAYER` membership plus their team-specific Discord role; there is no global Player role. The service adds or removes only that team role, preserves unrelated and staff roles, repeats domain validation inside the database transaction, and compensates the Discord change if the database commit fails. If Discord role mutation fails, no roster transaction is committed. It records the normal signing/release transaction and audit-domain history but intentionally publishes neither Audit nor Transfer Market messages; centralized Audit + Transfer routing is deferred to the next hotfix.

Live mutations force a fresh Discord member-role snapshot, validate member/role feasibility, remove/add only roles that need changing, apply Discord first, then commit SQLite. The fresh snapshot prevents a stale role cache from suppressing a required `/staff remove` global-role operation. A failed commit triggers best-effort compensation of the exact role operations already applied. A compensation failure is logged and surfaced as requiring manual reconciliation; there is intentionally no retry queue or reconciliation command yet. Transfer Market publication occurs only after both critical steps and is non-critical afterward.

The in-memory confirmation registry provides random server-side tokens, initiating-user/guild/action/team/target binding, atomic consume/cancel, two-minute expiry, and callbacks for disabling or replacing expired/cancelled ephemeral components. Confirmation-time callers re-run authorization, membership, rank, team, and Discord feasibility checks. Restart safely invalidates pending confirmations.

Discord role changes require Manage Roles (or Administrator), but Administrator never bypasses hierarchy. The bot's highest role must be above the target member's highest role and every team/staff role being added or removed; the server owner cannot be role-managed. Recommended production order is: `SL Bot role`, playable administrator roles, `TM / ATM / PM`, then team roles. Administrators can still play when their highest role remains below the bot role.

Staff appointments and removals publish structured Transfer Market-only transaction embeds after critical Discord and database success. Their title uses the readable team-role name without `@` (`Role Transaction (Appointment|Demotion)`) because team names are no longer stored, with a safe `Team Transaction` fallback. The administrative actor appears as a mention in the body and by readable username, avatar, and UTC timestamp in the footer; appointment bodies use the configured staff-role mention. Audit remains reserved for setup/configuration events.

Accepted signings use a structured `✅ Offer Accepted - RoleName` Transfer Market card. It identifies the accepting player and team, shows `📁 Roster: current/max` followed by the current `💼 Team Manager`, and uses the signed player's readable username/avatar in a timestamped footer. A dedicated presentation provider resolves Discord names, avatars, guild icon, and team-role color before passing plain metadata to the message adapter.

## Stage 4B.2 demand and release

`/demand` derives the caller's team and rank from active memberships. An ordinary player confirms either `Demand` or `Cancel`. ATM/PM callers confirm `Leave Staff Position`, `Leave Team Completely`, or `Cancel`; staff-only departure ends the appointment, removes only the matching global staff role, retains the player row/team role, and returns the user to ordinary Players. Full demand ends both rows and removes the team plus matching staff role. TM cannot demand.

`/release player` derives the source team from the caller's active TM/ATM/PM appointment. TM may release ATM, PM, and ordinary players; ATM may release PM and ordinary players; PM may release ordinary players only. Self-release, TM targets, equal/higher ranks, free agents, and other-team targets are rejected. Release always ends the target's roster membership and any ATM/PM appointment, removes only the affected team/staff roles, and never asks or DMs the target.

Both commands use initiating-user, guild, action, team, target, and staff-rank-bound two-minute confirmations. Confirmation consumption is atomic and all eligibility plus forced Discord role feasibility is checked again. Critical role synchronization happens before the repeated database transaction; no success or public message occurs until both succeed. Completed movements publish only to Transfer Market. Full-demand cards use `📣 Demand - TeamRole` and an exact two-line blockquote (departure sentence, post-departure `📊 Roster`); staff-only demand uses the structured step-down Demotion card. Release cards use `🚪 Release - TeamRole` and an exact three-line blockquote (release sentence, post-release roster, current TM) plus a neutral `Player:` footer that does not reveal the acting manager. Missing role names fall back to `Team`. Announcement failure is logged and returned as a private warning without rolling back state.

## Stage 4B.3 promote and demote

`/promote player:<user> rank:<Assistant Team Manager|Player Manager>` and `/demote staff:<user>` provide team-controlled staff management.

- Authorization requires holding an active team staff appointment (TM/ATM for promote; TM for demote). Discord Administrators or Bot Permission holders without an active team staff appointment cannot run these commands (no administrative bypass).
- **`/promote`**: Allowed caller paths are TM (Player -> PM, Player -> ATM, PM -> ATM) and ATM (Player -> PM). ATM promoting to ATM or PM to ATM is blocked. There is no Team Manager choice registered or allowed. Self-promotion, free agents, other-team members, TM targets, occupied destination staff slots (`StaffSlotOccupiedError`), and targets already at the desired rank are rejected.
- **`/demote`**: TM callers may demote ATM or PM targets back to ordinary players. Self-demotion, ordinary players, TM targets, free agents, and other-team targets are rejected.
- Both commands use 2-minute initiator-only ephemeral confirmation prompts (`promotion-demotion-confirm:*`). Confirmation re-checks caller and target eligibility state.
- **Roster & Role Sync**: Player membership and team role are retained; roster count remains unchanged. Global staff roles (`TM`, `ATM`, `PM`) are synchronized. Historical staff appointments are preserved.
- **Transfer Market Cards**: Published strictly to Transfer Market with `⬆️ Promotion - TeamRole` / `⬇️ Demotion - TeamRole` card structures, single blockquote panel, roster line, TM line, actor footer with avatar and UTC timestamp. No Audit channel delivery.
- Enforces `BOT_OR_STAFF` channel policy.

## Stage 4B.4 team health

`TeamHealthService` reads active clubs, active `PLAYER` memberships, active staff appointments, and the effective team/guild squad limit without storing or mutating health state. Health is 🖤 for 0–4, 💛 for 5–9, 💚 for 10–15, and ❤️ for 16 or more; negative counts are rejected. Compact ordering reuses `/team list` repository ordering (`createdAt`, then club ID), excludes inactive teams, never truncates rows, and uses the neutral information color. Detailed mode revalidates guild ownership and active state, rejects a missing configured Discord role, uses the live role color and emoji thumbnail, and fetches role/member/user data after cache misses. Staff names use `<@USER_ID> \`VisibleName\`` and are resolved once per request.

## Stage 4C.1 franchise owner list (/folist)

`FranchiseOwnerListService` reads active clubs in `createdAt`, then club ID order, and fetches active `TEAM_MANAGER` appointments. Inactive teams, inactive memberships, ATM, PM, and ordinary players are excluded. Rows are formatted as `<emoji> <role mention> Team Manager: <formatted manager or Vacant>`, using `formatUserWithVisibleName` for resolved managers (`<@USER_ID> \`VisibleName\``) and `Vacant`when unassigned. The command is restricted to Staff Commands, requires administrative authorization, defers ephemerally, uses cold-cache safe role and user resolution, and chunks complete rows across embeds with title`Franchise Owner List`. Empty state produces `No active teams are currently configured.`.

## Stage 4C.2 team disbandment

`TeamDisbandmentCommandHandler` owns `/team disband team:<team>` warning, cancel, expiry, confirmation ownership, confirmation-time authorization/channel recheck, and private terminal presentation. `TeamDisbandmentService` revalidates the active guild-owned team and exact active membership set, then uses one Prisma transaction to end every active player/staff row, expire pending offers where the team is the destination or an affected active player is the source, mark the team inactive, and write `team.disbanded` audit metadata. Team rows, role IDs, emoji, users, ended memberships, terminal offers, transactions, and earlier audits remain intact.

Discord changes use the existing role-first coordinator in a multi-member batch. Each affected user loses the team role once; TM/ATM/PM users additionally lose only their matching configured global staff role. Ordinary players have no global Player role. A first or later role failure prevents the database transaction; a database failure compensates every applied member in reverse order. Compensation failures are logged and surfaced for manual reconciliation, and no success response is sent on partial failure.

## Emoji validation and thumbnails

Team creation requires a Unicode emoji or a custom emoji belonging to the current guild. Full mentions, `:name:`, and plain custom names are accepted; ambiguous names require a full mention. Deleted, malformed, and cross-server custom emoji are rejected. Single-team thumbnails are derived only from the team emoji through Discord's emoji CDN or Twemoji.

Single-team success and informational embeds use the current Discord team-role color. A missing role or a role whose color is `0` uses the existing success/info fallback color. Private offer DMs receive the already-resolved source-role name/color and guild author metadata from the command boundary; the DM adapter performs no guild lookup. The final card is titled `Contract Offer` and contains, in order, Source Team, Team Manager, `📊 Squad`, and a relative-only `⏰ Expires` timestamp. Persistent `✅ Sign Contract` and `❌ Decline Offer` buttons retain their original labels, styles, and custom IDs. Role names and colors are read from the live Discord guild cache and are never stored in Prisma.

## Presentation system foundation

Presentation logic is centralized under `src/bot/presentation/`:

- `emojis.ts`: Canonical `BOT_EMOJIS` dictionary (`teamManager: '👑'`, `assistantTeamManager: '👔'`, `playerManager: '🧠'`, `botPermissions: '⚡'`, `roster: '📊'`, `expiry: '⏰'`, `success: '✅'`, `error: '❌'`, `warning: '⚠️'`).
- `labels.ts`: Canonical `BOT_LABELS` dictionary (`Team Manager`, `Assistant Team Manager`, `Player Manager`, `Roster`, `Roster Count`, `Squad`, `Expires`, `Sign Contract`, `Decline Offer`, `Vacant`, `None`, `Unknown Team Role`).
- `colors.ts`: Canonical `BOT_COLORS` palette (`success: 0x57f287`, `info: 0x5865f2`, `warning: 0xfee75c`, `error: 0xed4245`, `neutral: 0x747f8d`) and `resolveTeamRoleColor`.
- `timestamps.ts`: Canonical timestamp formatters (`formatDiscordRelative`, `formatDiscordShortDateTime`, `formatDiscordLongDateTime`, `formatUtcFooterTimestamp`).
- `users.ts`: User presentation helpers (`formatUserMention`, `formatUserWithVisibleName`, `formatUserFooterName`, `sanitizeInlineCode`).
- `roles.ts`: Bot-layer team identity presentation wrappers (`formatTeamMessageIdentity`, `formatTeamReadableTitle`, `formatTeamPlainRoleName`, `formatTeamFooterIdentity`, `formatTeamAutocompleteIdentity`).
- `blockquotes.ts`: Blockquote helpers (`formatBlockquote`, `blockquoteLine`).
- `authors.ts` & `footers.ts`: Standardized embed author (`createGuildAuthor`) and footer builders (`createActorFooter`, `createPlayerFooter`, `createTimestampedFooter`).

Existing output is preserved while establishing single canonical meanings for emojis, labels, colors, and timestamps. Stage 4B.2 reuses these helpers for confirmations, successes, errors, and Transfer Market cards.

## Database and migrations

The Stage 4B.1 migration adds a partial unique index for one active staff appointment per guild/user. It complements the existing one-active-player-per-guild/user and one-holder-per-team/staff-slot indexes without changing or deleting historical rows. Prisma migrations remain the schema authority.

Tracked Prisma migrations are the authoritative database evolution mechanism. Any intentional change to `prisma/schema.prisma` must be accompanied by a new tracked migration:

1. In local development, create the migration with `prisma migrate dev --name <name>` (or `npm run prisma:migrate:dev -- --name <name>`).
2. Inspect the generated SQL under `prisma/migrations/<timestamp>_<name>/migration.sql`.
3. Commit `prisma/schema.prisma` and the new migration directory together.
4. Run `npm run prisma:generate` as needed. Generate updates the Prisma client; it does not modify the database and does not replace migration deployment.
5. Run validation and tests before sharing or deploying the change.

Never use `prisma db push` as the project's normal schema-evolution workflow. It can change a database without creating tracked migration history. Never edit a migration that has already been applied; create a new migration instead. `prisma migrate reset` is destructive and is only appropriate for a disposable local/test database, never production.

Production and other persistent deployments must apply committed migrations before starting the application:

```sh
npm run prisma:generate
npm run prisma:migrate:deploy
npm start
```

The application startup code does not run schema management automatically, so deployment/bootstrap must keep this order. Do not use `prisma db push`, `prisma migrate dev`, or an automatic reset in deployment. Production database contents are persistent state: never delete, reset, or overwrite the production database (including `/home/container/prisma/dev.db`) to resolve migration drift. Investigate the migration state and create a corrective migration when needed.

## Quality commands

```sh
npm run prisma:generate
npm run prisma:validate
npm run prisma:migrate:status
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run build
npm test
```
