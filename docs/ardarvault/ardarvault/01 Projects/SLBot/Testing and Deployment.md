---
title: SL Bot Testing & Deployment
type: testing-and-deployment
tags:
  - slbot
  - testing
  - vitest
  - gateway-intents
---

# Testing and Deployment Guide (Stage 4A Hotfix Updated)

Index: [[SLBot]] | Architecture: [[Architecture]]

## Test Suite Architecture

SL Bot utilizes **Vitest** for unit and integration testing.

- Integration tests use real **file-backed SQLite databases** generated dynamically in isolated temporary files.
- Tests apply committed migrations (`prisma migrate deploy`) against fresh SQLite databases.
- Schema evolution tests verify column renames (`botPermissionsRoleId`).
- Network calls to Discord are mocked (`DiscordOfferMessageAdapter` mocks).

### Running Quality & Test Verification

```bash
npm run prisma:generate
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run build
npm test
```

Current test count: **177 passing tests** across 13 test suites.

## Gateway Intent Review

SL Bot requires only **one non-privileged Gateway intent**:

- `GatewayIntentBits.Guilds`

### Intent Policies:

- **Message Content Intent**: Disabled (Commands use native Discord Slash Commands).
- **Presence Intent**: Disabled.
- **Server Members Intent (`GuildMembers`)**: Disabled (Roster lists consume SQLite database records; member identity resolution uses interaction data and user lookup without background guild sweeps).

## Manual Live Smoke Test Walkthrough

To verify Stage 4A Hotfix in a live Discord development server:

1. Deploy guild commands:
   ```bash
   npm run commands:deploy:guild
   ```
2. Start the bot:
   ```bash
   npm run dev
   ```
3. Test `/health` in bot commands or staff channel (Expect ephemeral embed).
4. Run `/setup league` to set offer timeout.
5. Run `/setup channels` to link bot-commands, staff, transfer, and audit channels.
6. Run `/setup roles` with `bot_permissions` role option.
7. Run `/setup view` to confirm configured state and check for missing items.
8. Test channel policy & permission enforcement:
   - Try `/team list` in an unauthorized channel (Expect ephemeral error embed mentioning target channels).
   - Run `/team list` in bot commands or staff channel (Expect public embed listing active teams with custom emoji mentions).
   - Try `/team add` without `bot_permissions` role or Admin permission (Expect ephemeral permission error embed).
   - Run `/team add` with custom emoji `<:name:123456789012345678>` in staff channel (Expect public success embed with derived CDN thumbnail URL).
9. Manage squad limits via `/limit default`, `/limit team`, `/limit reset`, and `/limit view`.
10. Test `/team remove` to safely deactivate a team.
11. Verify contract offers (`/offer create`) deliver private DMs with custom emoji thumbnails while posting a public embed acknowledgement in channel.

Related notes: [[Commands]], [[Product Decisions]], [[Session Log]]
