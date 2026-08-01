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

SL Bot provides automated, authoritative league administration for Discord and SQLite. The current Stage 4A correction set adds guild-name custom emoji resolution, guild-specific fixed-order team banners configured by `/bannerconfig`, intentional text fallbacks for Discord autocomplete, vertical TM/ATM/PM staff presentation, role-safe roster banners, ephemeral administrative successes, authorization-aware channel guidance, and setup/configuration Discord audit publishing.

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
