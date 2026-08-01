# SL Bot

SL Bot is a TypeScript Discord administration bot for the SL League. Stage 4A provides focused command subcommands, channel policy enforcement, squad limit management, guild-configurable team banners, public informational responses, custom and Unicode Discord emoji team branding, embed-only responses with consistent `✅`/`❌` formatting, global staff uniqueness rules, specific conflict error messages, roster reference layout, and structured project documentation while retaining legacy Python implementation files and `superleague.db` as untouched references.

The database is authoritative. Discord roles are linked presentation and authorization objects; this stage never assigns or removes them automatically.

## Command tree

- `/setup`
  - `league`: Set default offer timeout for the league. (Ephemeral administrative embed; mirrors to audit when configured)
  - `channels`: Configure bot-commands, staff, transfer, and audit channels. (Ephemeral administrative embed; publishes to the newly saved audit channel)
  - `roles`: Configure bot_permissions, team_manager, assistant_manager, and player_manager roles. (Ephemeral administrative embed; mirrors to audit when configured)
  - `view`: Display current league configuration and missing settings. (Ephemeral administrative embed; never publishes an audit message)
- `/bannerconfig has_emoji:<bool> has_name:<bool> has_short:<bool> has_role:<bool>`: Configure the guild-wide fixed-order team banner. Every option is required, at least one must be enabled, the response is ephemeral, and a successful change mirrors to the audit channel when configured.
- `/team`
  - `add`: Register a new team linked to an existing role with required Discord emoji branding. (Ephemeral embed in staff channel)
  - `edit`: Update team name, short name, role, or team emoji. (Ephemeral embed in staff channel)
  - `remove`: Safe soft deactivation of an active team while preserving all historical records (memberships, staff appointments, offers, transactions, and audit events). Full franchise shutdown is reserved for the future `/disband` workflow. (Ephemeral embed in staff channel)
  - `list`: List active teams in the compact `<configured banner> — current/max` format. (Public embed in bot-commands or staff)
- `/limit`
  - `default`: Set guild-wide default squad limit (1–100, default 17). (Ephemeral embed in staff channel)
  - `team`: Set squad limit override for a specific club (1–100). (Ephemeral embed in staff channel)
  - `reset`: Clear squad limit override for a specific club. (Ephemeral embed in staff channel)
  - `view`: Display guild default and per-club overrides. (Public embed in bot-commands or staff)
- `/staff`
  - `appoint`: Appoint a Team Manager, Assistant Team Manager, or Player Manager. (Ephemeral embed in staff channel)
  - `remove`: Remove active holder of a staff position. (Ephemeral embed in staff channel)
  - `list`: List active team staff as vertical per-team blocks with the configured banner and friendly position titles. (Public embed in bot-commands or staff)
- `/roster`: Display the configured team banner without putting role mentions in the title, followed by the actual Team Manager, Assistant Team Manager, and Player Manager sections, player divider, and player list. There is no Assistant Coach section. (Public embed in an authorized bot-commands or staff channel)
- `/offer player:<user>`: Send a private contract offer DM on behalf of the source team derived from the caller's active database TM/ATM/PM appointment. Active team staff cannot receive player offers until removed from staff. Sign Contract and Decline Offer buttons remain persistent, while the command acknowledgement edits the original ephemeral response and labels the issuing club as `Source Team`.
- `/health`: Report bot and database status ephemerally (`Online ✅`, `Connected ✅`). (Ephemeral embed in bot-commands or staff)
- `/debugreset`: Temporary development-only command (`SLBOT_ENABLE_DEBUG_COMMANDS=true`) for Discord Administrators to reset all server application data safely. Only the initiating Administrator can use its confirmation buttons.

Team inputs use database-backed autocomplete. Choice values are immutable internal club IDs, never names, abbreviations, banners, roles, or emoji values. Inactive teams are excluded and every selected club ID is revalidated within the current guild during execution.

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
- **Staff-Only Commands** (`/setup *`, `/bannerconfig`, `/team add|edit|remove`, `/limit default|team|reset`, `/staff appoint|remove`): Must be used strictly in the configured **Staff Channel**.
- **Bootstrap Exception**: Before the staff channel or `bot_permissions` role is configured, a Discord Administrator may execute `/setup` commands in the current channel.
- **Administrative Visibility**: Successful setup, team mutation, limit mutation, staff mutation, debug-reset, and offer acknowledgements are ephemeral. `/setup view` is also ephemeral. Team/staff/limit lists and rosters stay public, health stays ephemeral, and the private contract DM remains visible only to its target.
- **Embed-Only Responses**: Every command response is a Discord embed with `✅` prefixes for successful administrative output and `❌` prefixes for errors, ending with an explicit actor line when applicable.
- **Ephemeral Errors**: All handled errors produce visible ephemeral red error embeds detailing specific conflicts without exposing database IDs or stack traces.
- **Permission-Aware Guidance**: Administrative permission is checked before staff-channel guidance is revealed. Ordinary users never receive protected staff-channel details; globally authorized callers receive guidance for the configured channels available to them.

## Team branding with emojis

- `/team add` requires a team emoji; `/team edit` allows optional emoji updates.
- Accepts full server custom mentions (`<:name:emojiId>`, `<a:name:emojiId>`), wrapped names (`:name:`), plain names (`name`), or standard Unicode emoji sequences such as `⚽`, `🇹🇷`, `👍🏽`, and family ZWJ emoji.
- Custom mention IDs must exist in the current guild. Wrapped or plain names resolve by exact case-insensitive guild-emoji name and must have exactly one match; ambiguous names require the full custom mention. Deleted and cross-server emojis are rejected.
- `/bannerconfig` controls four guild-specific Boolean components: emoji, name, short name, and role. The default is emoji plus role (`true`, `false`, `false`, `true`), at least one must remain enabled, and fixed component order is always `<emoji> Name (SHORT) @Role`; free-form templates and custom ordering are not supported. Safe previews use the fictional `.examplept. Example Preview Team (EPT) @ExamplePreviewTeam`, reduced to `.examplept. @ExamplePreviewTeam` under defaults.
- Normal embeds and messages use real custom emoji mentions and Discord role mentions. Legacy records with missing emoji or role data omit those components safely.
- Discord autocomplete choice labels are plain text and cannot render guild custom emoji images. Unicode renders directly; custom emoji intentionally use `.emojiName.` text, and `@RoleName` appears only when the guild cache resolves it. Raw custom emoji IDs, custom mentions, and role IDs are never exposed, choice values remain club IDs, and labels are limited safely to Discord's 100-character maximum without splitting graphemes.
- Staff appointment and removal confirmations include the affected user, friendly position name, and configured team banner. Staff directory output keeps the banner in normal text rather than a bold embed field heading, then uses one line each for `👑 Team Manager`, `👔 Assistant Team Manager`, and `🧠 Player Manager`, with `Vacant` for empty positions.
- Single-team embeds (team add/edit confirmations, roster views, offer cards) use derived CDN or Twemoji URLs as their embed thumbnail.
- Multi-team list embeds display team emojis inline beside team names.

## Setup audit publishing

Successful `/setup league`, `/setup channels`, `/setup roles`, and `/bannerconfig` mutations publish an embed-only audit message to the configured audit channel when one is available. `/setup channels` saves first and can publish immediately to the newly configured audit channel. Banner audit messages list every enabled or disabled component and a safe preview. Audit messages contain meaningful configuration details, the actor mention as the final field, and a timestamp without internal database IDs or secrets. Delivery failure is logged and does not roll back the saved configuration. Discord audit publishing for team, limit, staff, and debug-reset mutations remains deferred to later stages.

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
