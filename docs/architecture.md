# Architecture

## Boundaries and construction

Discord adapters translate interactions into plain service inputs. Services own authorization, workflows, and transaction boundaries. Repositories own scoped persistence. Prisma and the Discord client are constructed once and injected; runtime registration is static.

```text
Discord commands, autocomplete, and buttons
                    |
                    v
       authorization/workflow services
                    |
                    v
              repositories
                    |
                    v
             Prisma + SQLite
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

The final corrective SQLite migration rebuilds `GuildSettings` without the former banner booleans and rebuilds `Club` without `name` or `shortName`. `emoji` becomes non-null. Retained fields are copied verbatim, prior migration files remain immutable, and the role, id/guild, and active indexes are recreated.

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

`/team list` renders one `identity — current/max` line per active team. Staff directories render one normal-text identity followed by vertical TM/ATM/PM lines and `Vacant` slots. Rosters use `<emoji> @RoleName Roster`, never put raw role mention markup in the title, and have no separate `Team` field. Their footer is `Roster for <footer-safe identity>, <server name>`; custom emoji use `.name.` there. Thumbnails derive only from emoji.

Offer creation still derives the issuing/source team from the caller's active database staff appointment. The private DM and acknowledgement label that team `Source Team`; the ephemeral acknowledgement names the target, actor, and source identity in that order. Discord-role derivation and role synchronization remain deferred.

The Discord interaction adapter is the single role-metadata boundary and exposes cached `{ id, name, color }`. Single-team embeds use a nonzero role color directly; a missing/zero-color role keeps the existing embed fallback. The command resolves presentation metadata before private offer delivery, so the DM adapter never queries Discord. Role colors are not persisted and require no schema change.

## Setup auditing

`GuildSetupService` owns league, channel, role, and read-only view operations. Successful setup mutations persist before `SetupAuditService` performs best-effort Discord publication. Channel setup uses the newly saved audit channel. Adapter failure is logged without rollback. Setup view has no team-identity settings section and never publishes. General mutation auditing remains out of scope.

## Squad limits

Effective capacity is `club.squadLimitOverride ?? settings.defaultSquadLimit`. Only active player memberships count. Limit DTOs carry the `Club` record rather than duplicating obsolete presentation fields.
