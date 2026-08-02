---
title: SL Bot Architecture
type: architecture
tags:
  - slbot
  - architecture
  - stage4a
---

# SL Bot Architecture

## Layering

Discord adapters translate gateway interactions into plain inputs. Services own authorization and transactions. Repositories own database access. Prisma/SQLite is authoritative for guilds, internal club IDs, memberships, staff appointments, offers, transactions, and audits.

## Team identity model

`Club` retains `id`, `guildId`, required `discordRoleId`, required `emoji`, active state, squad-limit override, legacy logo storage, timestamps, and relations. There is no team display name or abbreviation. `GuildSettings` has no team-identity presentation switches.

`formatTeamIdentity(team, mode)` is the sole formatter:

- Message mode: canonical emoji plus `<@&roleId>`.
- Title mode: canonical emoji plus cached `@RoleName`, or `<emoji> Team` when unresolved.
- Footer mode: Unicode or `.emojiName.` plus cached `@RoleName`; unresolved roles use `Unknown Team Role`.
- Autocomplete mode: cached `@RoleName` only; unresolved roles use `Unknown Team Role`.
- Choice value: stable internal club ID.

Role uniqueness is enforced within each guild across active and inactive clubs. Execution always revalidates the chosen club ID in the current guild.

## Migration model

The appended final-identity migration rebuilds both SQLite tables without changing deployed migrations. It removes obsolete club presentation columns/indexes and former guild presentation settings, makes emoji non-null, copies all retained values, and recreates role uniqueness plus composite/index guarantees. Tests migrate a populated relational graph and run `PRAGMA foreign_key_check`.

## Authorization and policy

Global access: guild owner, Discord Administrator, or configured `bot_permissions` role. Club staff scope: active database TM/ATM/PM appointment. Explicit channel scopes are subcommand-aware: `/health`, `/team list`, `/staff list`, `/roster`, `/limit view`, `/offer`, `/demand`, and `/release` are `BOT_OR_STAFF`; setup/team/staff/limit mutations, setup view, and debug reset are `STAFF_ONLY`. Command-channel access never grants command authority. Transfer Market and Audit are output-only bot-operation channels. Non-global callers (ordinary players and TM/ATM/PM callers without global administrative authorization) receive channel guidance mentioning only Bot Commands (`Use this command in <#botCommandsChannelId>.`) to ensure Staff Commands is never disclosed. Globally authorized callers receive concise guidance mentioning both channels for BOT_OR_STAFF commands (`Use this command in <#botCommandsChannelId> or <#staffCommandsChannelId>.`) and staff-channel guidance for STAFF_ONLY commands (`Use this command in <#staffCommandsChannelId>.`). Channel-not-configured errors remain distinct.

## Presentation and auditing

Presentation logic is centralized under `src/bot/presentation/` (`emojis.ts`, `labels.ts`, `colors.ts`, `timestamps.ts`, `users.ts`, `roles.ts`, `blockquotes.ts`, `authors.ts`, `footers.ts`, `index.ts`). Canonical emojis (`BOT_EMOJIS`), labels (`BOT_LABELS`), colors (`BOT_COLORS`), timestamps (`formatUtcFooterTimestamp`, `formatDiscordRelative`), user formatting (`formatUserMention`, `formatUserWithVisibleName`), role formatting (`formatTeamMessageIdentity`, `formatTeamPlainRoleName`), and embed builders (`createGuildAuthor`, `createActorFooter`, `createPlayerFooter`) are shared across all bot commands and adapters.

The shared identity is used by team, staff, roster, limit, offer, and conflict output. Normal output remains `<emoji> <@&roleId>`. Staff directories are vertical and chunked safely. Rosters have no title; their description begins `<emoji> <@&roleId> Roster`, contains no separate `Team` field, and ends with `Roster for <footer-safe identity>, <server name>`; custom footer emoji use `.emojiName.`. Thumbnails derive only from emoji.

The Discord interaction adapter supplies cached role `{ id, name, color }` metadata. Single-team embeds use a nonzero role color and keep their existing fallback when the role is missing or colorless. Resolved source-role color is passed into private offer delivery; the DM adapter does not query Discord. Role colors are never persisted.

Setup league/channels/roles persist before best-effort Audit publication. Player and staff movements publish to Transfer Market only after database and Discord role success. Announcement failure is logged without rolling back completed state.

## Offer boundary

The issuing/source team is still derived from the caller's active database staff appointment. Offer creation and acceptance require a free agent. Acceptance rechecks free-agent state, team validity, and capacity, adds only the team role, commits the signing, then publishes to Transfer Market. Competing pending offers remain historical but become unacceptable after a signing. Demand's in-memory guild/user limiter stores a one-minute expiry only on successful acquisition; blocked retries report the decreasing remainder without changing expiry, and channel validation occurs first so wrong-channel attempts consume nothing.

## Stage 4B.1 mutation boundary

Every staff member has an active `PLAYER` row for the same guild/team plus one TM/ATM/PM row. Staff count toward capacity but roster presentation filters active staff user IDs out of ordinary Players, so each person is displayed once. Staff-only removal or demotion ends only the staff row; `/staff remove` preserves the prior rank to remove its configured global role while retaining the player row and team role. Full departure/release ends both. The central transaction service re-reads eligibility, preserves history, records actors/end times, enforces capacity and uniqueness, and returns discord.js-free role and announcement plans. A partial unique index enforces one active staff row per guild/user under races.

Discord roles are validated and changed before SQLite commits. The adapter force-fetches the member so stale cached role IDs cannot suppress `/staff remove`, then checks member existence, Manage Roles, configured role existence, managed roles, and hierarchy. It skips truly redundant API operations and compensates exactly the operations applied when the commit fails. Failed compensation is logged and surfaced for manual reconciliation. SQLite and Discord cannot be atomic, and this stage intentionally adds no retry queue or reconciliation command.

Administrator grants permission but never bypasses hierarchy. The bot's highest role must be above both the target member's highest role and every affected team/staff role; the server owner cannot be managed. Production order is `SL Bot role`, playable administrator roles, TM/ATM/PM, then team roles. Administrators may play only below the bot role.

Structured staff appointment/demotion embeds go to Transfer Market only after critical success; Audit remains for configuration. They use the server author/icon, team-role color, emoji thumbnail, and readable `TeamRole Transaction (...)` title without `@` because no team name is stored. The administrative actor is mentioned in the body and appears by readable username/avatar with a UTC timestamp in the footer. Structured signing cards use `✅ Offer Accepted - TeamRole`, acceptance text, roster current/max, the current TM, and a signed-player username/avatar footer. Full demand uses `📣 Demand - TeamRole` plus exactly two adjacent blockquote lines (sentence, post-roster); release uses `🚪 Release - TeamRole` plus exactly three (sentence, post-roster, current TM) and hides the actor. Both fall back to `Team`. A presentation provider supplies plain Discord metadata before rendering, so the message adapter does not query users, roles, or guild presentation independently. Offer DMs remain unchanged: Source Team, Team Manager, `📊 Squad`, relative-only `⏰ Expires`, and persistent ✅/❌ buttons.

The in-memory confirmation registry binds random tokens to initiator, guild, action, team, target, and caller/target rank, atomically consumes one of multiple decisions or cancellation, expires after two minutes, and supports ephemeral UI expiry/cancel callbacks. Restart invalidation is safe. Fresh authorization, membership, team, rank, and Discord role feasibility run after consumption.

## Stage 4B.2 departure boundary

`RosterDepartureService` derives demand/release teams from active membership and staff rows. `/demand` blocks TM and free agents. `/release` enforces self, exact-team, free-agent, TM-target, and TM > ATM > PM > player hierarchy rules with no global permission bypass. Expected caller and target ranks are passed into the central mutation transaction so confirmation state cannot silently drift.

`RosterDepartureCommandHandler` owns the ephemeral prompts and terminal component replacement. Ordinary demand offers Demand/Cancel; ATM/PM offers staff-only/full/cancel; release offers Release/Cancel. The reusable one-minute in-memory guild/user demand limiter is refreshed for invocation, blocked retry, cancel, expiry, failed recheck, and success. `/release` has no limiter.

Full demand/release removes the team role plus the matching configured ATM/PM role when applicable and ends both active membership rows. Staff-only demand removes only the matching global role, ends only the staff row, and retains capacity/team membership. All history is retained and no departure Audit event is written. The existing forced member fetch, hierarchy checks, role-first ordering, database recheck, compensation, and post-success best-effort Transfer Market delivery remain the synchronization boundary.

Demand and release cards use server author/icon, plain team-role title, team color/thumbnail, one blockquote panel, post-mutation roster data, UTC player footer, and no audit/reason details. Release also shows the current TM but never identifies the acting manager. Staff-only demand uses the Demotion card with `stepped down to player` and `Action by` wording.

Related notes: [[Commands]], [[Product Decisions]], [[Roadmap]]
