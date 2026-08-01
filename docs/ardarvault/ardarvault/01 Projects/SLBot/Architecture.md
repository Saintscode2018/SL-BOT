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

Global access: guild owner, Discord Administrator, or configured `bot_permissions` role. Club staff scope: active database TM/ATM/PM appointment. Informational commands use Bot Commands (and Staff for global callers); administrative commands use Staff; `/offer` accepts Bot Commands or Staff. Protected channel details are disclosed only after authorization.

## Presentation and auditing

The shared identity is used by team, staff, roster, limit, offer, and conflict output. Normal output remains `<emoji> <@&roleId>`. Staff directories are vertical and chunked safely. Rosters use `<emoji> @RoleName Roster`, contain no separate `Team` field, and end with `Roster for <footer-safe identity>, <server name>`; custom footer emoji use `.emojiName.`. Thumbnails derive only from emoji.

The Discord interaction adapter supplies cached role `{ id, name, color }` metadata. Single-team embeds use a nonzero role color and keep their existing fallback when the role is missing or colorless. Resolved source-role color is passed into private offer delivery; the DM adapter does not query Discord. Role colors are never persisted.

Setup league/channels/roles persist before best-effort audit publication. Adapter failure is logged without rollback. Setup view is private, read-only, unaudited, and has no team-identity configuration section. Other Discord mutation auditing remains deferred.

## Offer boundary

The issuing/source team is still derived from the caller's active database staff appointment. The ephemeral acknowledgement says the private offer was sent to the target by the actor on behalf of that source identity. Discord-role synchronization and role-derived source selection are deliberately not implemented.

Related notes: [[Commands]], [[Product Decisions]], [[Roadmap]]
