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

- `/setup league|channels|roles|view`: Configure or inspect league settings. Mutations are ephemeral and publish best-effort audit messages; `view` is ephemeral, read-only, unaudited, and contains no team-identity settings section.
- `/team add role:<role> emoji:<emoji>`: Add a team. Both options are required.
- `/team edit team:<club> [role:<role>] [emoji:<emoji>]`: Edit a role and/or emoji. Supplying neither change is rejected.
- `/team remove team:<club>`: Soft-deactivate a team while preserving history.
- `/team list`: Public `identity — current/max` lines.
- `/limit default|team|reset|view`: Manage the guild default and team overrides; team output uses only the shared identity.
- `/staff appoint|remove|list`: Manage TM, ATM, and PM appointments. Appointment also ensures an active player roster row; staff-only removal retains that row and the team role while removing the matching configured global staff role. Public lists use vertical per-team blocks and `Vacant`.
- `/roster team:<club>`: Public roster whose description begins `<emoji> <@&RoleId> Roster`, with no title or separate `Team` field, followed by effective squad count, TM/ATM/PM fields, and players. Active staff count toward capacity but appear only in their staff field, never again under ordinary Players. Its footer is `Roster for <footer-safe team identity>, <server name>`.
- `/offer player:<user>`: Send a private contract offer for the team derived from the caller's active database staff appointment. Only free agents can receive or accept one. Acceptance adds the team role and publishes the completed signing to Transfer Market.
- `/health`: Ephemeral bot/database health.
- `/debugreset`: Development-only, Discord-Administrator reset flow when `SLBOT_ENABLE_DEBUG_COMMANDS=true`.

`/bannerconfig` has been removed. A stale cached interaction is rejected with a safe ephemeral response.

## Authorization, channels, and visibility

Global administration requires the server owner, Discord Administrator permission, or the configured `bot_permissions` role. TM/ATM/PM appointments grant only club-scoped operations.

- Informational `/team list`, `/staff list`, `/roster`, and `/limit view` output is public in Bot Commands; globally authorized callers may also use Staff.
- `/offer` is allowed in Bot Commands or Staff and checks channel policy before resolving the caller's database appointment.
- `/setup *`, `/team add|edit|remove`, `/limit default|team|reset`, and `/staff appoint|remove` are Staff-only.
- Successful mutations, offer acknowledgements, setup view, health, and all handled errors are ephemeral.
- Setup league/channels/roles mutations publish timestamped actor-attributed audit embeds when configured. Player and staff movements use Transfer Market instead; announcement failure is logged but does not roll back completed state.

## Stage 4B.1 movement foundation

`RosterMutationService` is the shared transaction boundary for signing, appointment, staff-only departure, full departure/release, promotion, and demotion. It re-reads guild/team/member/staff state in the commit transaction, preserves ended history and the previous staff rank, records actors, enforces squad and staff-slot limits, and returns plain role and announcement plans. Every active TM/ATM/PM therefore also has an active `PLAYER` membership on the same team. One active player row and one active staff row per user are enforced per guild; each staff slot remains unique per team. `/staff remove` uses the preserved rank to remove only the configured TM/ATM/PM role, leaving the active player membership and team role intact.

Live mutations force a fresh Discord member-role snapshot, validate member/role feasibility, remove/add only roles that need changing, apply Discord first, then commit SQLite. The fresh snapshot prevents a stale role cache from suppressing a required `/staff remove` global-role operation. A failed commit triggers best-effort compensation of the exact role operations already applied. A compensation failure is logged and surfaced as requiring manual reconciliation; there is intentionally no retry queue or reconciliation command yet. Transfer Market publication occurs only after both critical steps and is non-critical afterward.

The in-memory confirmation registry provides random server-side tokens, initiating-user/guild/action/team/target binding, atomic consume/cancel, two-minute expiry, and callbacks for disabling or replacing expired/cancelled ephemeral components. Confirmation-time callers must use its execution callback to re-run authorization and eligibility. Restart safely invalidates pending confirmations. No `/demand`, `/release`, `/promote`, `/demote`, or `/folist` command is registered in Stage 4B.1; those are planned for Stage 4B.2–4B.4.

Discord role changes require Manage Roles (or Administrator), but Administrator never bypasses hierarchy. The bot's highest role must be above the target member's highest role and every team/staff role being added or removed; the server owner cannot be role-managed. Recommended production order is: `SL Bot role`, playable administrator roles, `TM / ATM / PM`, then team roles. Administrators can still play when their highest role remains below the bot role.

Staff appointments and removals publish structured Transfer Market-only transaction embeds after critical Discord and database success. Their title uses the readable team-role name without `@` (`Role Transaction (Appointment|Demotion)`) because team names are no longer stored, with a safe `Team Transaction` fallback. The administrative actor appears as a mention in the body and by readable username, avatar, and UTC timestamp in the footer; appointment bodies use the configured staff-role mention. Audit remains reserved for setup/configuration events.

Accepted signings use a structured `✅ Offer Accepted - RoleName` Transfer Market card. It identifies the accepting player and team, shows `📁 Roster: current/max` followed by the current `💼 Team Manager`, and uses the signed player's readable username/avatar in a timestamped footer. A dedicated presentation provider resolves Discord names, avatars, guild icon, and team-role color before passing plain metadata to the message adapter.

## Emoji validation and thumbnails

Team creation requires a Unicode emoji or a custom emoji belonging to the current guild. Full mentions, `:name:`, and plain custom names are accepted; ambiguous names require a full mention. Deleted, malformed, and cross-server custom emoji are rejected. Single-team thumbnails are derived only from the team emoji through Discord's emoji CDN or Twemoji.

Single-team success and informational embeds use the current Discord team-role color. A missing role or a role whose color is `0` uses the existing success/info fallback color. Private offer DMs receive the already-resolved source-role name/color and guild author metadata from the command boundary; the DM adapter performs no guild lookup. The final card is titled `Contract Offer` and contains, in order, Source Team, Team Manager, `📊 Squad`, and a relative-only `⏰ Expires` timestamp. Persistent `✅ Sign Contract` and `❌ Decline Offer` buttons retain their original labels, styles, and custom IDs. Role names and colors are read from the live Discord guild cache and are never stored in Prisma.

## Database and migrations

The Stage 4B.1 migration adds a partial unique index for one active staff appointment per guild/user. It complements the existing one-active-player-per-guild/user and one-holder-per-team/staff-slot indexes without changing or deleting historical rows. Prisma migrations remain the schema authority.

Prisma migrations are the schema authority; do not substitute `prisma db push`.

## Quality commands

```sh
npm run prisma:generate
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run build
npm test
```
