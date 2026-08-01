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

SL Bot provides automated, authoritative league administration for Discord and SQLite. It tracks active clubs, team managers, roster memberships, contract offers, transfers, releases, and squad capacity limits.

## Quick Navigation

- [[Architecture]] — System layering, database authority, Prisma transactions, and audit logging.
- [[Commands]] — Current Stage 4A slash command tree, channel policy rules, and response visibility matrix.
- [[Product Decisions]] — Key architectural rules: DB authority, staff structure, squad limits, channel rules, DM contract cards.
- [[Roadmap]] — Development stages progress, Stage 4A scope, planned future stages, and excluded features.
- [[Testing and Deployment]] — Vitest integration suite, SQLite migrations, Gateway intent requirements, manual smoke test checklist.
- [[Session Log]] — Chronological log of development sessions and changes made.

## Current Project Status

- **Current Branch**: `stage4a/setup-channels-limits`
- **Current Stage**: **Stage 4A — Setup Channels & Limits**
- **Test Baseline**: 162/162 integration & unit tests passing
- **Database Engine**: SQLite 3 with Prisma ORM 6.19.3
- **Bot Engine**: Node.js 22 + TypeScript + `discord.js` v14.27
