---
title: SL Bot Testing and Deployment
type: testing-and-deployment
tags:
  - slbot
  - testing
  - vitest
---

# Testing and Deployment Guide

## Automated verification

```bash
npm run prisma:generate
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run build
npm test
git diff --check
```

Integration tests use isolated file-backed SQLite databases and apply committed migrations with `prisma migrate deploy`. Coverage includes:

- Fresh schema without obsolete club presentation columns or guild presentation settings.
- Populated Stage 4A migration preserving settings, club keys/role/emoji/state/limit, player and staff memberships, offer, transaction, and audit.
- Foreign-key integrity, composite references, role uniqueness, and removed indexes.
- Formatter behavior for Unicode/custom message, title, footer, and role-only autocomplete modes, fallback labels, whitespace, raw-ID exclusion, and 100-character limit.
- Presentation unit coverage (`tests/unit/presentation.test.ts`) for `BOT_EMOJIS`, `BOT_LABELS`, `BOT_COLORS`, timestamp helpers, user formatting, blockquote formatting, author builders, and actor/player footers.
- Final team command registration and stale-command rejection.
- Club-ID autocomplete round-trips through roster, staff, and limit execution.
- Team list, staff wording/directory, final roster title/footer/fields, team-role colors and fallbacks, limit output, exact offer acknowledgement/source/private-DM color, setup view, setup audits, authorization, channel policy, debug reset, and offer-button regressions.

## Gateway intents

Only `GatewayIntentBits.Guilds` is required. Message Content, Presence, and Guild Members privileged intents remain disabled.

## Live smoke test

1. Deploy commands with `npm run commands:deploy:guild`; verify `/bannerconfig` is absent.
2. Run `/setup league`, `/setup channels`, `/setup roles`, and `/setup view`. Confirm mutations are ephemeral and audited, while view is private, unaudited, and has no team-identity settings section.
3. Run `/team add role emoji` with Unicode, static custom, and animated custom emoji. Reject malformed, deleted, and cross-server emoji.
4. Run `/team edit team [role] [emoji]`; verify role-only and emoji-only edits, exact no-change error, and duplicate-role error with no database IDs.
5. Verify autocomplete labels are exactly cached `@RoleName`, fall back to `Unknown Team Role`, contain no emoji, mentions, or raw IDs, and execute using the returned club ID.
6. Verify `/team list` uses exactly `identity — current/max` per line.
7. Verify staff appointment/removal wording and vertical public directory blocks with `Vacant`.
8. Verify the roster has no title, its description begins `<emoji> <@&roleId> Roster`, there is no `Team` field, and the effective count, exact TM/ATM/PM headings, players, emoji thumbnail, author, and `Roster for <team>, <server>` footer remain intact.
9. Verify team limit update/reset/view output uses only identity and single-team embeds use the current nonzero Discord role color; zero/missing colors use the existing fallback.
10. Run `/offer player` as active database staff. Confirm the ephemeral acknowledgement says “sent to target by actor on behalf of source team,” the private DM uses the supplied source-role color when available, `Source Team` remains intact, no public follow-up occurs, and active-staff target blocking stays red.
11. Confirm ordinary users never receive protected Staff-channel details and every handled error is ephemeral.
12. With `SLBOT_ENABLE_DEBUG_COMMANDS=true`, verify `/debugreset` remains Discord-Administrator-only and preserves its confirmation safety checks.
13. Simulate setup audit delivery failure and confirm persistence is not rolled back.

Stage 4B.1 automated coverage includes roster/staff invariants, history, guild/team isolation, capacity, database uniqueness, Discord feasibility and hierarchy, redundant operations, partial compensation and compensation failure, confirmation ownership/expiry/cancel/double-click/tampering/recheck/restart, free-agent offer rechecks, competing offers, announcement ordering/channel/identity/color, and non-critical announcement failure.

For deployment, verify the bot has Manage Roles or Administrator and use this role order: SL Bot, playable administrator roles, TM/ATM/PM, then team roles. The bot must also be above each target member's highest role; Administrator does not bypass hierarchy, and the server owner cannot be managed. Exercise all three staff appointments/removals and offer acceptance in a test guild. Confirm staff count toward the roster while appearing once, removal keeps the team role/player row but removes the global rank, roles change before success, completed movement goes to Transfer Market rather than Audit, and a deliberately unavailable announcement channel logs without reverting membership. SQLite/Discord coordination still has an unavoidable compensation window and no automatic retry or reconciliation command.

Presentation checks cover structured staff Appointment/Demotion cards with role-name titles that have no leading `@`, server icon/color/thumbnail, configured staff-role mention, administrative actor in the body and readable avatar/timestamp footer, no Franchise Owner wording, and safe `Team Transaction` fallback. Signing checks cover the exact `✅ Offer Accepted - TeamRole` title, acceptance description, roster current/max, current TM, and signed-player avatar/timestamp footer. Private offer checks retain the exact server author, `Contract Offer` title, Source Team/Team Manager/`📊 Squad`/`⏰ Expires` order, readable role with no raw ID or `@unknown-role`, relative-only expiry, and unchanged persistent button IDs/styles/labels with ✅/❌ emoji.

The command-path staff-removal test must force the Discord operation to remain pending and prove that TM/ATM/PM removal uses the configured global role ID, never the team role, while success, database history changes, and Transfer Market publication wait for role removal to resolve.

Role-derived offer source, public release/demand/promotion/demotion/folist commands, imports, team-inactivation removal, and general mutation audit publication are not part of this deployment.

Related notes: [[Commands]], [[Product Decisions]], [[Session Log]]
