---
title: SL Bot Commands
type: reference
tags:
  - slbot
  - commands
  - stage4a
---

# Command Architecture and Visibility Matrix

## Command tree

```text
/health
/setup
  league [offer_timeout_minutes]
  channels bot_commands staff transfer audit
  roles bot_permissions team_manager assistant_manager player_manager
  view
/team
  add role emoji
  edit team [role] [emoji]
  remove team
  list
/limit
  default amount
  team team amount
  reset team
  view [team]
/staff
  appoint team user staff_type
  remove team staff_type
  list [team]
/roster team
/offer player
/demand
/release player
/debugreset  (development flag only)
```

`/bannerconfig` has been removed. `/team add` has no other options. `/team edit` rejects an invocation that supplies neither role nor emoji.

## Team selectors

All `team` string options use the same database-backed autocomplete. Labels contain only the cached readable role name, such as `@T1`, `@T2`, or `@Chelsea`. If the cache cannot resolve the role, the label is exactly `Unknown Team Role`. Labels never contain Unicode/custom emoji, `.emojiName.`, team aliases, role IDs, emoji IDs, or mentions; choice values remain internal club IDs.

## Visibility and channels

| Command                       | Channel                                     | Authorization                                         | Response                                                           |
| ----------------------------- | ------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| `/health`                     | Bot Commands or Staff                       | Any allowed caller                                    | Ephemeral                                                          |
| `/setup *`                    | Staff; Administrator bootstrap before setup | Global                                                | Ephemeral                                                          |
| `/team add\|edit\|remove`     | Staff                                       | Global                                                | Ephemeral                                                          |
| `/team list`                  | Bot Commands or Staff                       | Any allowed caller                                    | Public                                                             |
| `/limit default\|team\|reset` | Staff                                       | Global                                                | Ephemeral                                                          |
| `/limit view`                 | Bot Commands or Staff                       | Any allowed caller                                    | Public                                                             |
| `/staff appoint\|remove`      | Staff                                       | Global                                                | Ephemeral                                                          |
| `/staff list`                 | Bot Commands or Staff                       | Any allowed caller                                    | Public                                                             |
| `/roster`                     | Bot Commands or Staff                       | Any allowed caller                                    | Public                                                             |
| `/offer`                      | Bot Commands or Staff                       | Active database TM/ATM/PM appointment                 | Ephemeral acknowledgement + private DM                             |
| `/demand`                     | Bot Commands or Staff                       | Player, ATM, or PM with active membership; TM blocked | Ephemeral confirmation/result; public Transfer Market success only |
| `/release player`             | Bot Commands or Staff                       | Active TM/ATM/PM, exact own-team hierarchy            | Ephemeral confirmation/result; public Transfer Market success only |
| `/debugreset`                 | Staff once configured                       | Discord Administrator                                 | Ephemeral                                                          |

Errors are always ephemeral. Stale commands receive an ephemeral `Command Unavailable` response. Transfer Market and Audit are output-only for bot operations, so commands are rejected there before confirmations, mutations, or announcements. Wrong-channel responses use exact concise wording (`Use this command in <channel list>.`). Non-global callers (including TM/ATM/PM callers without global administrative authorization) see channel guidance mentioning only Bot Commands (`Use this command in <#botCommandsChannelId>.`); Staff Commands is never disclosed to non-global callers. Unauthorized callers on STAFF_ONLY commands receive `Permission Denied` without channel guidance.

## Output contracts

- Team list: `<team identity> — current/max`.
- Staff appointment/removal: affected user, friendly position, and team identity; actor field last.
- Staff list: normal identity line, then vertical `👑 Team Manager`, `👔 Assistant Team Manager`, and `🧠 Player Manager` lines using `Vacant`.
- Roster: no title; description starts `<emoji> <@&roleId> Roster`, with no `Team` field, exact TM/ATM/PM sections, player divider/list, emoji thumbnail, league author, and `Roster for <footer-safe identity>, <server name>` footer. Custom emoji become `.emojiName.` only in the footer.
- Limit: team identity only.
- Offer: `Source Team` is the caller's active database staff club. The target must be a free agent at creation and acceptance. Successful acceptance adds the team role and produces a Transfer Market signing announcement after the database commit.
- Roster: TM/ATM/PM player rows count toward capacity but active staff appear only under their staff heading, not again under Players. After `/staff remove`, the retained member returns to Players.
- Staff removal: ends staff history and removes only the matching configured global role; the roster membership and team role remain.
- Staff Transfer Market cards: titles use the team-role name without `@`; appointment/removal bodies mention the administrative actor and their readable username/avatar appears in the timestamped `Appointed by`/`Demoted by` footer.
- Accepted signing: `✅ Offer Accepted - TeamRole`, acceptance description, `📊 Roster: current/max`, `👑 Team Manager`, and a timestamped `Player:` footer using the signed player's readable username/avatar.
- Private offer: the command resolves a readable source role and guild author metadata before delivery. The card is `Contract Offer` with Source Team, Team Manager, `📊 Squad`, and relative-only `⏰ Expires`; the persistent buttons render `✅ Sign Contract` and `❌ Decline Offer` with unchanged IDs.
- Demand: ordinary player buttons are Demand/Cancel. ATM/PM buttons are Leave Staff Position/Leave Team Completely/Cancel. TM never receives a prompt. Every confirmation is initiator/guild/team/rank-bound, expires after two minutes, and performs a fresh membership/rank/Discord-role check. The one-minute per-guild/user in-memory limiter is fixed-window: only an allowed attempt stores expiry; blocked retries count down without extension, and wrong-channel attempts do not consume it.
- Staff-only demand: ends the ATM/PM row, removes only that global role, retains the roster/team role and count, and publishes a `stepped down to player` Demotion card.
- Full demand: ends roster plus ATM/PM row when present, removes the team plus matching staff role, and publishes `📣 Demand - TeamRole` (fallback `Team`) with exactly two adjacent blockquote lines: demand sentence and post-roster `📊 Roster`. The affected-player `Action by` footer remains.
- Release: caller team comes only from the active staff appointment. TM releases ATM/PM/player; ATM releases PM/player; PM releases player. No self-release, TM release, other-team release, target approval, reason, or DM. The public `🚪 Release - TeamRole` card (fallback `Team`) has exactly three adjacent blockquote lines: release sentence, post-roster `📊 Roster`, and current `👑 Team Manager`; its neutral affected-player footer reveals no acting manager.
- Presentation foundation: Presentation strings, emojis (`BOT_EMOJIS`), labels (`BOT_LABELS`), colors (`BOT_COLORS`), and formatters are centralized in `src/bot/presentation/`.
- Setup view: channels, roles, settings, and missing configuration only; no team-identity configuration and no audit publication.

Single-team team/staff/limit/roster/offer embeds use the current nonzero Discord team-role color. Missing or zero-color roles retain the existing fallback color. Role colors are cache-derived presentation data and are not stored.

Stage 4B.2 implements only `/demand` and `/release`. `/promote`, `/demote`, and `/folist` remain planned and are not registered.

Staff appointment/demotion transaction cards publish to Transfer Market, never Audit, and title the action with the readable team role name—without a leading `@`—rather than a removed team name. The live removal path force-refreshes member roles before deciding whether to call Discord. Discord changes require Manage Roles/Administrator plus hierarchy: place the SL Bot role above playable admin roles, TM/ATM/PM, and team roles. Administrator does not bypass hierarchy, and the server owner cannot be role-managed.

Related notes: [[Architecture]], [[Product Decisions]], [[Testing and Deployment]]
