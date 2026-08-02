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
- [[Commands]] — Current Stage 4A command tree, options, visibility, and autocomplete.
- [[Product Decisions]] — Locked behavior and exclusions.
- [[Roadmap]] — Completed work and Stage 4B+ boundaries.
- [[Testing and Deployment]] — Verification and live smoke tests.
- [[Session Log]] — Final Stage 4A simplification record.

## Current status

- `/team add role emoji` and `/team edit team [role] [emoji]` are final.
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
- Discord role work requires Manage Roles/Administrator and a bot role above playable admin roles, staff roles, team roles, and the target's highest role. Administrator cannot bypass hierarchy; the server owner cannot be managed.
- `/demand`, `/release`, `/promote`, `/demote`, `/folist`, role-derived offer source, and general mutation audit publication remain out of scope for the public command surface.
