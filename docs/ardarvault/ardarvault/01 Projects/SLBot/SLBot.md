---
title: SL Bot Project Overview
type: project-index
tags:
  - slbot
  - discord-bot
  - roblox-football-league
---

# SL Bot Project Brain

Welcome to the project memory for **SL Bot**, the official Discord administration bot for the Roblox Super League (SL).

## Project Overview

SL Bot provides automated, authoritative league administration for Discord and SQLite. The final Stage 4A correction set uses emoji-plus-role banner defaults, safe `.examplept.` previews, `.emojiName.` plain-text autocomplete fallbacks with immutable club-ID values, compact team lists, normal-text staff banners, transactionally correlated roster reads, active-staff offer restrictions, ephemeral `Source Team` acknowledgements, persistent private offer buttons, authorization-aware channel guidance, and setup/configuration Discord audit publishing.

## Quick Navigation

- [[Architecture]] — System layering, database authority, Prisma transactions, banner formatting, global staff uniqueness, structured channel policy, and setup audit delivery.
- [[Commands]] — Current Stage 4A command tree, `/bannerconfig`, authorization-aware channel rules, embed-only response rules, and visibility matrix.
- [[Product Decisions]] — Global permissions, bootstrap recovery, response visibility, guild emoji resolution, standard labels, private offers, accurate roster roles, and setup audit scope.
- [[Roadmap]] — Development stages progress, Stage 4A Polish scope, planned future stages, and excluded features.
- [[Testing and Deployment]] — Vitest integration suite, SQLite migrations, Gateway intent requirements, manual smoke test checklist.
- [[Session Log]] — Chronological log of development sessions and changes made.

## Current Project Status

- **Current Branch**: `stage4a-polish/errors-branding-command-ui`
- **Current Stage**: **Stage 4A Polish — Live-Test Corrections**
- **Database Engine**: SQLite 3 with Prisma ORM 6.19.3
- **Bot Engine**: Node.js 22 + TypeScript + `discord.js` v14.27
