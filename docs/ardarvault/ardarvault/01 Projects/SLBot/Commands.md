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
/debugreset  (development flag only)
```

`/bannerconfig` has been removed. `/team add` has no other options. `/team edit` rejects an invocation that supplies neither role nor emoji.

## Team selectors

All `team` string options use the same database-backed autocomplete. Labels contain only the cached readable role name, such as `@T1`, `@T2`, or `@Chelsea`. If the cache cannot resolve the role, the label is exactly `Unknown Team Role`. Labels never contain Unicode/custom emoji, `.emojiName.`, team aliases, role IDs, emoji IDs, or mentions; choice values remain internal club IDs.

## Visibility and channels

| Command         | Channel                                     | Authorization                                             | Response                               |
| --------------- | ------------------------------------------- | --------------------------------------------------------- | -------------------------------------- | --------- | --------- |
| `/health`       | Bot Commands; Staff for global admins       | Any allowed caller                                        | Ephemeral                              |
| `/setup *`      | Staff; Administrator bootstrap before setup | Global                                                    | Ephemeral                              |
| `/team add      | edit                                        | remove`                                                   | Staff                                  | Global    | Ephemeral |
| `/team list`    | Bot Commands; Staff for global admins       | Any allowed caller                                        | Public                                 |
| `/limit default | team                                        | reset`                                                    | Staff                                  | Global    | Ephemeral |
| `/limit view`   | Bot Commands; Staff for global admins       | Any allowed caller                                        | Public                                 |
| `/staff appoint | remove`                                     | Staff                                                     | Global                                 | Ephemeral |
| `/staff list`   | Bot Commands; Staff for global admins       | Any allowed caller                                        | Public                                 |
| `/roster`       | Bot Commands; Staff for global admins       | Any allowed caller                                        | Public                                 |
| `/offer`        | Bot Commands or Staff                       | Active database TM/ATM/PM or global path plus appointment | Ephemeral acknowledgement + private DM |
| `/debugreset`   | Staff once configured                       | Discord Administrator                                     | Ephemeral                              |

Errors are always ephemeral. Stale commands receive an ephemeral `Command Unavailable` response.

## Output contracts

- Team list: `<team identity> — current/max`.
- Staff appointment/removal: affected user, friendly position, and team identity; actor field last.
- Staff list: normal identity line, then vertical `👑 Team Manager`, `👔 Assistant Team Manager`, and `🧠 Player Manager` lines using `Vacant`.
- Roster: `<emoji> @RoleName Roster` title (or `<emoji> Team Roster` when the role is unresolved), no `Team` field, exact TM/ATM/PM sections, player divider/list, emoji thumbnail, league author, and `Roster for <footer-safe identity>, <server name>` footer. Custom emoji become `.emojiName.` only in the footer.
- Limit: team identity only.
- Offer: `Source Team` is the caller's active database staff club. The exact acknowledgement order is target, actor, then source team (“sent to … by … on behalf of …”); it remains ephemeral and DM delivery remains private with no public follow-up.
- Setup view: channels, roles, settings, and missing configuration only; no team-identity configuration and no audit publication.

Single-team team/staff/limit/roster/offer embeds use the current nonzero Discord team-role color. Missing or zero-color roles retain the existing fallback color. Role colors are cache-derived presentation data and are not stored.

Related notes: [[Architecture]], [[Product Decisions]], [[Testing and Deployment]]
