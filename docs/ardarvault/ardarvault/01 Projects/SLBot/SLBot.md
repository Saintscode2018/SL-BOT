---
title: SL Bot
type: project
tags:
  - slbot
  - discord
  - stage4a
---

# SL Bot Project Brain

## Project overview

SL Bot is a TypeScript/Discord.js league administration bot backed by Prisma and SQLite. Internal club IDs are stable database identities; Discord supplies readable role names and renders role mentions.

The permanent team identity is only `<emoji> <@&DiscordRoleId>`. Emoji and Discord role are required. There is no team display name, abbreviation, or presentation configuration.

## Quick navigation

- [[Architecture]] — Boundaries, schema, identity formatting, authorization, and migrations.
- [[Commands]] — Current Stage 4B.2 command tree, options, visibility, and autocomplete.
- [[Product Decisions]] — Locked behavior and exclusions.
- [[Roadmap]] — Completed work and Stage 4B+ boundaries.
- [[Testing and Deployment]] — Verification and live smoke tests.
- [[Session Log]] — Final Stage 4A simplification record.

## Current status

- `/team add role emoji` and `/team edit team [role] [emoji]` are final.
- `/team disband team` replaces `/team remove`: global administrators in Staff Commands confirm an initiator-owned destructive action that ends all active memberships, removes team plus matching staff roles, expires related pending offers, marks the team inactive, and audits the result while preserving the team role, emoji, rows, and history.
- `/bannerconfig` is removed and stale cached interactions fail safely.
- Autocomplete uses only `@CachedRoleName` (or `Unknown Team Role`) with club IDs as values.
- Roster, staff, limit, team, offer, and relevant error output share `formatTeamIdentity`.
- Rosters have no title; the description starts with `<emoji> <@&roleId> Roster`, has no `Team` field, and retains the readable team/server footer.
- Active TM/ATM/PM rows count toward roster capacity but appear only under staff headings; `/staff remove` returns the retained member to Players, keeps the team role, and removes the matching global staff role.
- Single-team embeds and private offer DMs use live nonzero Discord role colors, with safe fallbacks and no persisted color data.
- The ephemeral offer acknowledgement names the target, actor, and source team and never creates a public follow-up.
- Setup view contains only channels, roles, operational settings, and missing configuration.
- Offer source still derives from the caller's active database staff appointment.
- Stage 4B.1 provides shared transactional roster/staff mutations, Discord role synchronization with compensation, two-minute server-side confirmations, Transfer Market announcements, and free-agent-only offer acceptance.
- Staff Appointment/Demotion cards use readable team-role titles without `@`, mention the administrative actor in the body, and show that actor's readable username/avatar in a timestamped footer. Accepted signings use `✅ Offer Accepted - TeamRole`, roster/TM lines, and a signed-player footer. All publish to Transfer Market rather than Audit. Private offer cards remain unchanged.
- `/staff remove` force-refreshes the member's live roles before removing the configured global rank, then retains the roster membership and team role.
- Stage 4B.2 exposes `/demand` in Bot Commands or Staff with a fixed one-minute in-memory guild/user window and two-minute confirmation. Wrong-channel and rate-limited retries do not start or extend the original expiry. Ordinary players leave fully; ATM/PM may step down to player or leave fully; TM demand is blocked.
- Stage 4B.2 exposes `/release player` only in Bot Commands or Staff. Active TM/ATM/PM database rank controls the own-team hierarchy; self-release, TM targets, free agents, other teams, and equal/higher authority are blocked. The target receives no confirmation or DM.
- Full departures remove only the affected team/global staff roles and end roster/staff rows historically. Staff-only demand keeps the roster/team role and removes only the matching ATM/PM role. Completed movement goes to Transfer Market, never Audit.
- Non-admin/team-user and informational commands use Bot Commands or Staff; configuration/admin mutations use Staff only. Transfer Market and Audit are output-only bot-operation channels. Wrong-channel errors use exact normalized wording (`Use this command in <channel list>.`). Non-global callers (including TM/ATM/PM callers without global administrative authorization) see channel guidance mentioning only Bot Commands (`Use this command in <#botCommandsChannelId>.`); Staff Commands is never disclosed to non-global callers. Unauthorized callers on STAFF_ONLY commands receive `Permission Denied` without channel guidance. Full-demand cards are `📣 Demand - TeamRole` with two adjacent quoted lines; release cards are `🚪 Release - TeamRole` with three adjacent quoted lines and no actor disclosure. Missing role names fall back to `Team`.
- Discord role work requires Manage Roles/Administrator and a bot role above playable admin roles, staff roles, team roles, and the target's highest role. Administrator cannot bypass hierarchy; the server owner cannot be managed.
- Presentation logic is centralized under `src/bot/presentation/` (`BOT_EMOJIS`, `BOT_LABELS`, `BOT_COLORS`, `timestamps.ts`, `users.ts`, `roles.ts`, `blockquotes.ts`, `authors.ts`, `footers.ts`); full cosmetic pass is deferred.
- Stage 4B.3 exposes `/promote player rank` and `/demote staff` in Bot Commands or Staff with 2-minute initiator-only confirmations. Active TM/ATM database rank controls promotion (TM: Player -> PM, Player -> ATM, PM -> ATM; ATM: Player -> PM only) and TM rank controls demotion (ATM/PM -> Player). Self-action, free agents, other-team members, TM targets, occupied destination slots, and targets already at the desired rank are rejected. Promoted and demoted cards publish to Transfer Market only.
- `/folist` and `/team disband` are implemented. Role-derived offer source and general mutation audit publication remain out of scope for the public command surface.
