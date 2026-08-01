# SL Bot

SL Bot is a TypeScript Discord administration bot for the SL League. The database is authoritative for stable internal records; Discord supplies readable role names and renders team role mentions. Legacy Python files and `superleague.db` remain untouched references.

## Team identity

A team is identified only by its required emoji and required Discord role:

```text
<emoji> <@&ROLE_ID>
```

There is no team display name, abbreviation, or configurable banner. `Club.id` remains the stable database identity used by commands and relations. The final schema keeps the club guild, Discord role, emoji, active state, squad-limit override, timestamps, and historical relationships. Discord roles are not synchronized automatically.

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
- `/staff appoint|remove|list`: Manage TM, ATM, and PM appointments. Confirmations identify the affected user, friendly position, and team identity. Public lists use vertical per-team blocks and `Vacant`.
- `/roster team:<club>`: Public roster titled `<emoji> @RoleName Roster`, with no separate `Team` field, followed by effective squad count, TM/ATM/PM fields, and players. Its footer is `Roster for <footer-safe team identity>, <server name>`.
- `/offer player:<user>`: Send a private contract offer for the team derived from the caller's active database staff appointment. The ephemeral acknowledgement states that the offer was sent to the target by the actor on behalf of the source team; the issuing club field remains `Source Team`.
- `/health`: Ephemeral bot/database health.
- `/debugreset`: Development-only, Discord-Administrator reset flow when `SLBOT_ENABLE_DEBUG_COMMANDS=true`.

`/bannerconfig` has been removed. A stale cached interaction is rejected with a safe ephemeral response.

## Authorization, channels, and visibility

Global administration requires the server owner, Discord Administrator permission, or the configured `bot_permissions` role. TM/ATM/PM appointments grant only club-scoped operations.

- Informational `/team list`, `/staff list`, `/roster`, and `/limit view` output is public in Bot Commands; globally authorized callers may also use Staff.
- `/offer` is allowed in Bot Commands or Staff and checks channel policy before resolving the caller's database appointment.
- `/setup *`, `/team add|edit|remove`, `/limit default|team|reset`, and `/staff appoint|remove` are Staff-only.
- Successful mutations, offer acknowledgements, setup view, health, and all handled errors are ephemeral.
- Setup league/channels/roles mutations publish timestamped actor-attributed audit embeds when configured. Delivery failure does not roll back saved settings. Team, limit, staff, and debug-reset Discord audit publishing remains deferred.

## Emoji validation and thumbnails

Team creation requires a Unicode emoji or a custom emoji belonging to the current guild. Full mentions, `:name:`, and plain custom names are accepted; ambiguous names require a full mention. Deleted, malformed, and cross-server custom emoji are rejected. Single-team thumbnails are derived only from the team emoji through Discord's emoji CDN or Twemoji.

Single-team success and informational embeds use the current Discord team-role color. A missing role or a role whose color is `0` uses the existing success/info fallback color. Private offer DMs receive the already-resolved source-role color from the command boundary and otherwise retain their safe blurple fallback. Role names and colors are read from the live Discord guild cache and are never stored in Prisma.

## Database and migrations

The corrective final-identity migration rebuilds SQLite `Club` and `GuildSettings` without editing prior migrations. It removes `Club.name`, `Club.shortName`, their unique indexes, and all four former banner-setting columns. It preserves club IDs, guild IDs, roles, emojis, active states, limit overrides, settings, memberships, staff appointments, offers, transactions, audits, composite keys, and foreign keys. Role uniqueness within a guild remains enforced.

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
