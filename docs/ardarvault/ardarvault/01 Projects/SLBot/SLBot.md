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
- Rosters use `<emoji> @RoleName Roster`, no `Team` field, and a readable team/server footer; custom footer emoji use `.emojiName.`.
- Single-team embeds and private offer DMs use live nonzero Discord role colors, with safe fallbacks and no persisted color data.
- The ephemeral offer acknowledgement names the target, actor, and source team and never creates a public follow-up.
- Setup view contains only channels, roles, operational settings, and missing configuration.
- Offer source still derives from the caller's active database staff appointment.
- Discord role synchronization, role-derived offer source, transfers, release/demand, and general mutation audit publication remain out of scope.
