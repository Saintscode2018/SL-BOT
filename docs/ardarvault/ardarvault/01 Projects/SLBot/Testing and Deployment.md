---
title: SL Bot Testing & Deployment
type: testing-and-deployment
tags:
  - slbot
  - testing
  - vitest
  - gateway-intents
---

# Testing and Deployment Guide

Index: [[SLBot]] | Architecture: [[Architecture]]

## Test Suite Architecture

SL Bot utilizes **Vitest** for unit and integration testing.

- Integration tests use real **file-backed SQLite databases** generated dynamically in isolated temporary files.
- Tests apply committed migrations (`prisma migrate deploy`) against fresh SQLite databases.
- Network calls to Discord are mocked (`DiscordOfferMessageAdapter` mocks).

### Running Tests

```bash
npm run prisma:generate
npm test
```

Current test count: **162 passing tests** across 11 test suites.

## Gateway Intent Review

SL Bot requires only **one non-privileged Gateway intent**:

- `GatewayIntentBits.Guilds`

### Intent Policies:

- **Message Content Intent**: Disabled (Commands use native Discord Slash Commands).
- **Presence Intent**: Disabled.
- **Server Members Intent (`GuildMembers`)**: Disabled (Roster lists consume SQLite database records; member identity resolution uses interaction data and user lookup without background guild sweeps).

## Manual Live Smoke Test Walkthrough

To verify Stage 4A in a live Discord development server:

1. Deploy guild commands:
   ```bash
   npm run commands:deploy:guild
   ```
2. Start the bot:
   ```bash
   npm run dev
   ```
3. Test `/health` in any channel.
4. Run `/setup guild` to set offer timeout.
5. Run `/setup channels` to link bot-commands, staff, transfer, and audit channels.
6. Run `/setup roles` to assign league administrative roles.
7. Run `/setup view` to confirm configured state and check for missing items.
8. Test command policy enforcement:
   - Try `/team list` in a non-bot-commands channel (Expect ephemeral error mentioning `<#botCommandsChannelId>`).
   - Run `/team list` in the bot commands channel (Expect public response with team limits and remaining spaces).
   - Try `/team add` in a non-staff channel (Expect ephemeral error mentioning `<#staffChannelId>`).
9. Manage squad limits via `/limit default`, `/limit team`, `/limit reset`, and `/limit view`.
10. Verify contract offers (`/offer create`) deliver private DMs with squad limits resolved via effective limit rules.

Related notes: [[Commands]], [[Product Decisions]], [[Session Log]]
