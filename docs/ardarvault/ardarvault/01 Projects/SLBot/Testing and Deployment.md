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
- Team-health boundaries (0/4/5/9/10/15/16/17/above 17 and negative rejection), exact compact/detailed layout, active-only ordering/counts, effective limits, vacancies, empty state, row-safe chunking, global-admin Staff-only policy, invalid team rejection, and cold-cache role/member/user fetches.

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
14. Deploy guild commands and verify `/demand` has no options while `/release` has only required `player`.
15. In both Bot Commands and Staff, test ordinary demand (Demand/Cancel), ATM/PM staff-only/full/cancel, TM rejection, fixed one-minute ephemeral cooldown, two-minute expiry, and stale-state rejection. Retry after 30 seconds and verify about 30 seconds remain, then verify the original expiry still permits a new attempt at 60 seconds. Confirm wrong-channel attempts in Transfer Market, Audit, and random channels create no confirmation and do not consume or refresh cooldown. Confirm staff-only retains the team role/roster and removes only the matching staff role; full demand makes the user immediately offer-eligible.
16. From Bot Commands and Staff, test release as TM/ATM/PM against every hierarchy level. Confirm Transfer Market, Audit, and arbitrary channels return only an ephemeral wrong-channel error with no confirmation/mutation/announcement. Confirm own-team-only, no self/TM release, no target prompt/DM, no cooldown, and exact team/staff role removals.
17. Confirm demand/release successes publish only to Transfer Market after roles/database succeed. Demand must use `📣 Demand - TeamRole` with exactly two adjacent quoted lines; release must use `🚪 Release - TeamRole` with exactly three, including adjacent roster/TM lines. Check safe `Team` title fallback, post-roster count, current TM, team color/thumbnail, player avatar/timestamp footer, staff-only `stepped down` wording, and absence of manager identity/reason/audit in release.
18. In Staff Commands as the server owner, Administrator, and Bot Permissions member, run `/teamhealth` and `/teamhealth team:<team>`. Verify compact active-only order/count/heart rows and detailed TM/ATM/PM vacancies, effective limit, role color/mention, emoji/thumbnail, guild author, and actor UTC footer. Restart/clear caches and confirm role/user names fetch correctly. Verify ordinary TM/ATM/PM/player denial, wrong-channel denial, inactive/foreign/unknown/stale-role errors, 16 and above remaining ❤️, and enough teams to produce multiple untruncated embeds.

Stage 4B.1 automated coverage includes roster/staff invariants, history, guild/team isolation, capacity, database uniqueness, Discord feasibility and hierarchy, redundant operations, partial compensation and compensation failure, confirmation ownership/expiry/cancel/double-click/tampering/recheck/restart, free-agent offer rechecks, competing offers, announcement ordering/channel/identity/color, and non-critical announcement failure.

Stage 4B.2 automated coverage adds exact command registration, subcommand-aware Bot-or-Staff versus Staff-only policy, Transfer/Audit/arbitrary-channel rejection, wrong-channel no-confirmation/no-cooldown behavior, fixed non-sliding per-user/per-guild controllable-clock cooldown behavior, ordinary/ATM/PM prompts, cancellation/expiry/ownership/double-click/stale-rank handling, full/staff-only history and role plans, the complete release hierarchy, self/free-agent/other-team/TM rejection, post-roster/current-TM data, non-critical announcement failure, no departure audit, and exact demand/release/step-down presentation.

Stage 4B.3 automated coverage adds `/promote` and `/demote` command registration, options, and choices (`ATM`, `PM`, no `TM` choice); TM and ATM promotion authorization; TM demotion authorization; exact promotion paths (TM: Player -> PM, Player -> ATM, PM -> ATM; ATM: Player -> PM only); exact demotion paths (TM: ATM/PM -> Player); rejection of self-action, free agents, other-team members, TM targets, occupied destination slots (`StaffSlotOccupiedError`), and targets already at the desired rank; no administrative bypass; 2-minute initiator-only confirmations (`promotion-demotion-confirm:*`) with state re-checks; role synchronization (adding/removing matching global staff roles, keeping player membership and team role); and Transfer Market card formatting (`⬆️ Promotion - TeamRole` / `⬇️ Demotion - TeamRole`).

Stage 4B.4 team-health coverage adds optional team autocomplete registration, active-team read models, active-`PLAYER` counting, override/default effective limits, staff detail, all health boundaries, exact compact and continuous-blockquote presentation, empty state, deterministic row-safe chunking, `STAFF_ONLY` global authorization, invalid-team isolation, stale role rejection, and cache-miss role/user fetch behavior.

For deployment, verify the bot has Manage Roles or Administrator and use this role order: SL Bot, playable administrator roles, TM/ATM/PM, then team roles. The bot must also be above each target member's highest role; Administrator does not bypass hierarchy, and the server owner cannot be managed. Exercise all three staff appointments/removals, offer acceptance, promotion, and demotion in a test guild. Confirm staff count toward the roster while appearing once, removal/demotion keeps the team role/player row but removes the global rank, roles change before success, completed movement goes to Transfer Market rather than Audit, and a deliberately unavailable announcement channel logs without reverting membership. SQLite/Discord coordination still has an unavoidable compensation window and no automatic retry or reconciliation command.

Presentation checks cover structured staff Appointment/Demotion/Promotion cards with role-name titles that have no leading `@`, server icon/color/thumbnail, configured staff-role mention, administrative actor in the body and readable avatar/timestamp footer, no Franchise Owner wording, and safe `Team Transaction` fallback. Signing checks cover the exact `✅ Offer Accepted - TeamRole` title, acceptance description, roster current/max, current TM, and signed-player avatar/timestamp footer. Private offer checks retain the exact server author, `Contract Offer` title, Source Team/Team Manager/`📊 Squad`/`⏰ Expires` order, readable role with no raw ID or `@unknown-role`, relative-only expiry, and unchanged persistent button IDs/styles/labels with ✅/❌ emoji.

The command-path staff-removal test must force the Discord operation to remain pending and prove that TM/ATM/PM removal uses the configured global role ID, never the team role, while success, database history changes, and Transfer Market publication wait for role removal to resolve.

`/folist` command, release reasons, target DMs/approval, demand gameplay counts, pending-offer cancellation, role-derived offer source, imports, team-inactivation removal, and general mutation audit publication are not part of this deployment.

Related notes: [[Commands]], [[Product Decisions]], [[Session Log]]
