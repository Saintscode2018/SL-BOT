# SL Bot

SL Bot is a TypeScript Discord administration bot for the SL League. Stage 4A (with Stage 4A Polish updates) provides focused command subcommands, channel policy enforcement, squad limit management, public informational responses, custom & Unicode Discord emoji team branding, embed-only responses with consistent `✅`/`❌` formatting, global staff uniqueness rules, specific conflict error messages, roster reference layout, and structured project documentation while retaining legacy Python implementation files and `superleague.db` as untouched references.

The database is authoritative. Discord roles are linked presentation and authorization objects; this stage never assigns or removes them automatically.

## Command tree

- `/setup`
  - `league`: Set default offer timeout for the league. (Ephemeral administrative embed; mirrors to audit when configured)
  - `channels`: Configure bot-commands, staff, transfer, and audit channels. (Ephemeral administrative embed; publishes to the newly saved audit channel)
  - `roles`: Configure bot_permissions, team_manager, assistant_manager, and player_manager roles. (Ephemeral administrative embed; mirrors to audit when configured)
  - `view`: Display current league configuration and missing settings. (Ephemeral administrative embed; never publishes an audit message)
- `/team`
  - `add`: Register a new team linked to an existing role with required Discord emoji branding. (Ephemeral embed in staff channel)
  - `edit`: Update team name, short name, role, or team emoji. (Ephemeral embed in staff channel)
  - `remove`: Safe soft deactivation of an active team while preserving all historical records (memberships, staff appointments, offers, transactions, and audit events). Full franchise shutdown is reserved for the future `/disband` workflow. (Ephemeral embed in staff channel)
  - `list`: List active teams with role mentions, team emojis, player counts, effective limit, and remaining spaces. (Public embed in bot-commands or staff)
- `/limit`
  - `default`: Set guild-wide default squad limit (1–100, default 17). (Ephemeral embed in staff channel)
  - `team`: Set squad limit override for a specific club (1–100). (Ephemeral embed in staff channel)
  - `reset`: Clear squad limit override for a specific club. (Ephemeral embed in staff channel)
  - `view`: Display guild default and per-club overrides. (Public embed in bot-commands or staff)
- `/staff`
  - `appoint`: Appoint a Team Manager, Assistant Team Manager, or Player Manager. (Ephemeral embed in staff channel)
  - `remove`: Remove active holder of a staff position. (Ephemeral embed in staff channel)
  - `list`: List active team staff with team emojis and friendly position titles. (Public embed in bot-commands or staff)
- `/roster`: Display team roster with the actual Team Manager, Assistant Team Manager, and Player Manager sections, followed by the player divider and player list. There is no Assistant Coach section. (Public embed in an authorized bot-commands or staff channel)
- `/offer player:<user>`: Send a private contract offer DM to a player on behalf of the caller's team. Destination team is automatically derived from caller's active staff appointment. Includes Sign Contract and Decline Offer buttons, and outputs a public embed acknowledgement in channel.
- `/health`: Report bot and database status ephemerally (`Online ✅`, `Connected ✅`). (Ephemeral embed in bot-commands or staff)
- `/debugreset`: Temporary development-only command (`SLBOT_ENABLE_DEBUG_COMMANDS=true`) for Discord Administrators to reset all server application data safely. Only the initiating Administrator can use its confirmation buttons.

Team inputs use database-backed autocomplete. Inactive teams are excluded and every selected internal club ID is revalidated during execution.

## Authorization and Global Bot Permissions

Global bot administrative access requires either:

- being the Discord server owner,
- holding the configured `bot_permissions` role (`botPermissionsRoleId`), or
- having the Discord **Administrator** permission.

Discord Administrator permission provides a recovery path and enables bootstrap setup before the `bot_permissions` role or system channels are configured. Club staff roles (Team Manager, Assistant Team Manager, Player Manager) grant authority over their specific club operations (such as issuing offers), but DO NOT grant global bot permissions or setup access.

## Global Staff Uniqueness Rule

A user may hold only **one active club staff appointment across the entire league** (guild). A user cannot simultaneously be staff for multiple teams or hold multiple staff roles on different teams. Attempting to appoint an already-appointed user produces a clear ephemeral red error embed (`❌ Staff member already appointed`). Per-team position limits (one active TM, ATM, PM per team) are also strictly enforced (`❌ Position already occupied`).

## Channel policy and response visibility

Commands are enforced via `CommandChannelPolicyService`:

- **Informational Commands** (`/health`, `/team list`, `/staff list`, `/roster`, `/limit view`): Ordinary users use the configured **Bot Commands Channel**. Globally authorized callers may use either the bot-commands or staff channel.
- **Team-Staff Command** (`/offer`): Bot-commands and staff remain valid execution channels. Wrong-channel guidance mentions only bot commands to non-global callers; global callers may receive both configured channel mentions. A valid channel is checked before the active TM/ATM/PM appointment.
- **Staff-Only Commands** (`/setup *`, `/team add|edit|remove`, `/limit default|team|reset`, `/staff appoint|remove`): Must be used strictly in the configured **Staff Channel**.
- **Bootstrap Exception**: Before the staff channel or `bot_permissions` role is configured, a Discord Administrator may execute `/setup` commands in the current channel.
- **Administrative Visibility**: Successful setup, team mutation, limit mutation, staff mutation, and debug-reset responses are ephemeral. `/setup view` is also ephemeral. Team/staff/limit lists and rosters stay public, health stays ephemeral, and the successful offer acknowledgement stays public.
- **Embed-Only Responses**: Every command response is a Discord embed with `✅` prefixes for successful administrative output and `❌` prefixes for errors, ending with an explicit actor line when applicable.
- **Ephemeral Errors**: All handled errors produce visible ephemeral red error embeds detailing specific conflicts without exposing database IDs or stack traces.
- **Permission-Aware Guidance**: Administrative permission is checked before staff-channel guidance is revealed. Ordinary users never receive protected staff-channel details; globally authorized callers receive guidance for the configured channels available to them.

## Team branding with emojis

- `/team add` requires a team emoji; `/team edit` allows optional emoji updates.
- Accepts full server custom mentions (`<:name:emojiId>`, `<a:name:emojiId>`), wrapped names (`:name:`), plain names (`name`), or standard Unicode emoji sequences such as `⚽`, `🇹🇷`, `👍🏽`, and family ZWJ emoji.
- Custom mention IDs must exist in the current guild. Wrapped or plain names resolve by exact case-insensitive guild-emoji name and must have exactly one match; ambiguous names require the full custom mention. Deleted and cross-server emojis are rejected.
- User-facing team labels use `<emoji> Name (SHORT)`, falling back to `Name (SHORT)` for legacy records. Autocomplete renders Unicode directly and uses `:name:` for custom emoji while retaining the club ID as the choice value.
- Single-team embeds (team add/edit confirmations, roster views, offer cards) use derived CDN or Twemoji URLs as their embed thumbnail.
- Multi-team list embeds display team emojis inline beside team names.

## Setup audit publishing

Successful `/setup league`, `/setup channels`, and `/setup roles` mutations publish an embed-only audit message to the configured audit channel when one is available. `/setup channels` saves first and can publish immediately to the newly configured audit channel. Audit messages contain meaningful configuration details, the actor mention, and a timestamp without internal database IDs or secrets. Delivery failure is logged and does not roll back the saved configuration. Discord audit publishing for team, limit, staff, and debug-reset mutations remains deferred to later stages.

## Squad limit model

- Guild-wide default squad limit is **17**.
- Optional per-club override (`squadLimitOverride`).
- Effective limit = `squadLimitOverride ?? defaultSquadLimit`.
- Derived dynamically via domain helper `getEffectiveSquadLimit(club, settings)`.
- Staff appointments do not count toward player squad limits; staff members count as players only if they hold an active `PLAYER` membership.

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
