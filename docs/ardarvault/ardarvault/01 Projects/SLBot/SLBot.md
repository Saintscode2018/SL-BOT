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

SL Bot provides automated, authoritative league administration for Discord and SQLite. It tracks active clubs, team managers, roster memberships, contract offers, transfers, releases, custom & Unicode emoji team branding, global staff uniqueness rules, specific conflict error messages, and squad capacity limits.

## Quick Navigation

- [[Architecture]] — System layering, database authority, Prisma transactions, global staff uniqueness, and audit logging.
- [[Commands]] — Current Stage 4A Polish slash command tree, dual/staff channel policy rules, embed-only response rules (`✅`/`❌`), and visibility matrix.
- [[Product Decisions]] — Key architectural rules: global bot permissions, Discord Admin bootstrap recovery, embed responses, ephemeral errors, custom emoji team branding, DM contract cards, flattened `/offer`, reference roster layout.
- [[Roadmap]] — Development stages progress, Stage 4A Polish scope, planned future stages, and excluded features.
- [[Testing and Deployment]] — Vitest integration suite, SQLite migrations, Gateway intent requirements, manual smoke test checklist.
- [[Session Log]] — Chronological log of development sessions and changes made.

## Current Project Status

- **Current Branch**: `stage4a-polish/errors-branding-command-ui`
- **Current Stage**: **Stage 4A Polish — Errors, Branding & Command UX**
- **Database Engine**: SQLite 3 with Prisma ORM 6.19.3
- **Bot Engine**: Node.js 22 + TypeScript + `discord.js` v14.27
