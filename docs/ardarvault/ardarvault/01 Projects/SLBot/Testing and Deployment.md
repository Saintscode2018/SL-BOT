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
- Schema evolution tests verify schema recreation, the `botPermissionsRoleId` rename, fresh banner defaults, and migration of populated Stage 4A settings without data loss.
- Network calls to Discord are mocked (`DiscordOfferMessageAdapter`, setup-audit adapter, and bounded guild emoji records).

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
3. Test `/health` as an ordinary user in Bot Commands and as a global administrator in Bot Commands or Staff. Expect an ephemeral embed with `Online ✅` and `Connected ✅`.
4. Run `/setup league`, `/setup channels`, `/setup roles`, and `/setup view` in Staff. Expect ephemeral `✅` embeds. Verify league/channels/roles publish timestamped actor-attributed audit embeds, the first channels setup uses the new audit channel, setup view shows the default all-enabled banner and preview, and setup view publishes nothing.
5. Run `/bannerconfig` in Staff as owner, Discord Administrator, and a user with `bot_permissions`; verify each succeeds ephemerally and mirrors enabled/disabled values, preview, final actor field, and timestamp to Audit. Verify ordinary users and TM/ATM/PM-only users are denied without protected Staff-channel details. Reject all four false and confirm the prior database state and audit count are unchanged.
6. Test conflict error handling:
   - Try creating two teams with the same role (`❌ Team role already in use`).
   - Try creating two teams with the same name (`❌ Team name already in use`).
7. Test global staff uniqueness:
   - Appoint a user as Team Manager on Team A.
   - Try appointing the same user on Team B (`❌ Staff member already appointed`).
   - Try appointing a second Team Manager on Team A (`❌ Position already occupied`).
8. Test team branding with custom server emoji and Unicode emoji:
   - Run `/team add` with a full static mention, full animated mention, `:name:`, plain `name`, different name casing, `⚽`, a flag, a skin-tone emoji, and a ZWJ emoji.
   - Confirm missing, duplicate-name, deleted, cross-server, malformed text, and image URL inputs fail ephemerally. Duplicate names must request a full mention.
   - Verify default normal output uses `<emoji> Name (SHORT) @Role`. Toggle every banner component individually and in mixed combinations; confirm the fixed order, safe omission of missing legacy data, and all-false rejection.
   - Verify Unicode autocomplete renders directly, custom server emoji intentionally appears as `:emojiName:` text rather than an image, readable role names appear only when resolved, raw emoji/role IDs never appear, club IDs remain the choice values, and long labels remain at most 100 characters.
9. Verify `/staff appoint` and `/staff remove` name the affected user, friendly position, and configured banner. Verify `/staff list` uses one team block with three separate `👑`/`👔`/`🧠` lines, `Vacant` for empty positions, and no pipe separators.
10. Test flattened `/offer player:<user>`:

- Execute `/offer player:@user` as active staff (Expect private DM offer card to target player and public channel acknowledgement embed).

11. Test visual roster formatting via `/roster team:<id>`:

- Verify author, role-safe configured title, optional full-banner description, thumbnail, squad count, Team Manager, Assistant Team Manager, Player Manager, player divider/list, and footer across multiple banner configurations.
- Verify Franchise Owner, General Manager, Head Coach, and Assistant Coach are absent.

12. Test development reset (if `SLBOT_ENABLE_DEBUG_COMMANDS=true`):
    - Run `/debugreset` in staff channel as Discord Administrator (Expect warning prompt with 60s expiring confirmation buttons).
    - Verify only the initiating Discord Administrator can use the confirmation buttons.
13. Verify wrong-channel privacy:
    - Ordinary informational and `/offer` callers see only Bot Commands guidance.
    - Globally authorized callers see configured Bot Commands and Staff guidance.
    - Unauthorized administrative callers receive permission denied without a Staff channel mention.
14. Simulate setup or banner audit delivery failure and verify configuration stays saved, the ephemeral response contains only a safe warning, and no team/limit/staff/debug-reset Discord audit message is published.

Related notes: [[Commands]], [[Product Decisions]], [[Session Log]]
