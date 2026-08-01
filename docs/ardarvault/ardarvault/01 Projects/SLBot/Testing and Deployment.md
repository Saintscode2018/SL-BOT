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
8. Verify roster title is `<emoji> @RoleName Roster`, there is no `Team` field, and the effective count, exact TM/ATM/PM headings, players, emoji thumbnail, author, and `Roster for <team>, <server>` footer work for Unicode/custom emoji and missing roles.
9. Verify team limit update/reset/view output uses only identity and single-team embeds use the current nonzero Discord role color; zero/missing colors use the existing fallback.
10. Run `/offer player` as active database staff. Confirm the ephemeral acknowledgement says “sent to target by actor on behalf of source team,” the private DM uses the supplied source-role color when available, `Source Team` remains intact, no public follow-up occurs, and active-staff target blocking stays red.
11. Confirm ordinary users never receive protected Staff-channel details and every handled error is ephemeral.
12. With `SLBOT_ENABLE_DEBUG_COMMANDS=true`, verify `/debugreset` remains Discord-Administrator-only and preserves its confirmation safety checks.
13. Simulate setup audit delivery failure and confirm persistence is not rolled back.

Discord-role synchronization, role-derived offer source, transfers, release/demand, promotion/demotion, imports, and general mutation audit publication are not part of this deployment.

Related notes: [[Commands]], [[Product Decisions]], [[Session Log]]
