---
title: SL Bot Testing & Deployment
type: testing-and-deployment
tags:
  - slbot
  - testing
  - vitest
  - gateway-intents
---

# Testing and Deployment Guide (Stage 4A Polish Updated)

Index: [[SLBot]] | Architecture: [[Architecture]]

## Test Suite Architecture

SL Bot utilizes **Vitest** for unit and integration testing.

- Integration tests use real **file-backed SQLite databases** generated dynamically in isolated temporary files.
- Tests apply committed migrations (`prisma migrate deploy`) against fresh SQLite databases.
- Schema evolution tests verify schema recreation and column renames (`botPermissionsRoleId`).
- Network calls to Discord are mocked (`DiscordOfferMessageAdapter` mocks, mock guild emoji ID caches).

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

## Gateway Intent Review

SL Bot requires only **one non-privileged Gateway intent**:

- `GatewayIntentBits.Guilds`

### Intent Policies:

- **Message Content Intent**: Disabled (Commands use native Discord Slash Commands).
- **Presence Intent**: Disabled.
- **Server Members Intent (`GuildMembers`)**: Disabled (Roster lists consume SQLite database records; member identity resolution uses interaction data and user lookup without background guild sweeps).

## Manual Live Smoke Test Walkthrough

To verify Stage 4A Polish in a live Discord development server:

1. Deploy guild commands:
   ```bash
   npm run commands:deploy:guild
   ```
2. Start the bot:
   ```bash
   npm run dev
   ```
3. Test `/health` in bot commands or staff channel (Expect ephemeral embed with `Online ✅` and `Connected ✅`).
4. Run `/setup league`, `/setup channels`, `/setup roles`, `/setup view` in staff channel (Expect public embeds with `✅` titles, emoji field blocks, and actor lines).
5. Test conflict error handling:
   - Try creating two teams with the same role (`❌ Team role already in use`).
   - Try creating two teams with the same name (`❌ Team name already in use`).
6. Test global staff uniqueness:
   - Appoint a user as Team Manager on Team A.
   - Try appointing the same user on Team B (`❌ Staff member already appointed`).
   - Try appointing a second Team Manager on Team A (`❌ Position already occupied`).
7. Test team branding with custom server emoji and Unicode emoji:
   - Run `/team add` with `emoji: ⚽` or `<:custom:123456789012345678>`.
8. Test flattened `/offer player:<user>`:
   - Execute `/offer player:@user` as active staff (Expect private DM offer card to target player and public channel acknowledgement embed).
9. Test visual roster formatting via `/roster team:<id>`:
   - Verify author (`<Guild Name>`), title (`<EMOJI> <TEAM NAME> Roster`), thumbnail, squad count, staff sections, player list, and footer.
   - Verify Assistant Coach displays as a future unavailable role rather than missing server configuration.
10. Test development reset (if `SLBOT_ENABLE_DEBUG_COMMANDS=true`):
    - Run `/debugreset` in staff channel as Discord Administrator (Expect warning prompt with 60s expiring confirmation buttons).
    - Verify only the initiating Discord Administrator can use the confirmation buttons.

Related notes: [[Commands]], [[Product Decisions]], [[Session Log]]
