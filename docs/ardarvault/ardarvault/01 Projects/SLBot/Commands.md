---
title: SL Bot Command Tree & Visibility
type: commands-reference
tags:
  - slbot
  - commands
  - discord
---

# Command Architecture & Visibility Matrix (Stage 4A Hotfix Updated)

Index: [[SLBot]] | Architecture: [[Architecture]]

> [!IMPORTANT]
> Supersedes original Stage 4A matrix per Stage 4A Hotfix product decisions. All responses are Discord embeds. Errors are always ephemeral embeds.

## Stage 4A Hotfix Command Tree

```
/setup
  ├── league          (Inputs: [offer_timeout_minutes])
  ├── channels        (Inputs: bot_commands, staff, transfer, audit)
  ├── roles           (Inputs: bot_permissions, team_manager, assistant_manager, player_manager)
  └── view            (Displays league configuration & missing settings)

/team
  ├── add             (Inputs: name, short_name, role, [emoji], [logo_url])
  ├── edit            (Inputs: team, [name], [short_name], [role], [emoji], [logo_url])
  ├── remove          (Inputs: team) - Safe soft deactivation preserving historical records (distinguished from future /disband)
  └── list            (Displays active teams with custom emojis, counts, limits, remaining spaces)

/limit
  ├── default         (Inputs: amount 1-100)
  ├── team            (Inputs: team, amount 1-100)
  ├── reset           (Inputs: team)
  └── view            (Inputs: [team])

/staff
  ├── appoint         (Inputs: team, user, staff_type)
  ├── remove          (Inputs: team, staff_type)
  └── list            (Inputs: [team])

/roster               (Inputs: team)

/offer
  └── create          (Inputs: team, player)

/health               (Check bot & DB status)
```

## Response Visibility & Channel Matrix

| Command           | Allowed Channels                               | Authorization                       | Response Visibility                        |
| :---------------- | :--------------------------------------------- | :---------------------------------- | :----------------------------------------- |
| `/health`         | Bot Commands OR Staff                          | Normal bot user                     | **Ephemeral Embed**                        |
| `/setup league`   | Staff channel only (Bootstrap exception below) | Global bot permission               | **Public Embed**                           |
| `/setup channels` | Staff channel only (Bootstrap exception below) | Global bot permission               | **Public Embed**                           |
| `/setup roles`    | Staff channel only (Bootstrap exception below) | Global bot permission               | **Public Embed**                           |
| `/setup view`     | Staff channel only (Bootstrap exception below) | Global bot permission               | **Public Embed**                           |
| `/team add`       | Staff channel only                             | Global bot permission               | **Public Embed**                           |
| `/team edit`      | Staff channel only                             | Global bot permission               | **Public Embed**                           |
| `/team remove`    | Staff channel only                             | Global bot permission               | **Public Embed**                           |
| `/team list`      | Bot Commands OR Staff                          | Normal bot user                     | **Public Embed**                           |
| `/limit default`  | Staff channel only                             | Global bot permission               | **Public Embed**                           |
| `/limit team`     | Staff channel only                             | Global bot permission               | **Public Embed**                           |
| `/limit reset`    | Staff channel only                             | Global bot permission               | **Public Embed**                           |
| `/limit view`     | Bot Commands OR Staff                          | Normal bot user                     | **Public Embed**                           |
| `/staff appoint`  | Staff channel only                             | Global bot permission               | **Public Embed**                           |
| `/staff remove`   | Staff channel only                             | Global bot permission               | **Public Embed**                           |
| `/staff list`     | Bot Commands OR Staff                          | Normal bot user                     | **Public Embed**                           |
| `/roster`         | Bot Commands OR Staff                          | Normal bot user                     | **Public Embed**                           |
| `/offer create`   | Bot Commands OR Staff                          | Club Staff or Global bot permission | **Public Embed Ack** (DM to target player) |

### Bootstrap Exception Rules

- Before `staff` channel or `bot_permissions` role is configured, a Discord **Administrator** may execute setup commands in the current channel.
- Once configured, setup commands MUST be run in the `staff` channel.
- Ordinary users never receive bootstrap access.

All error responses and channel policy violations produce **ephemeral error embeds**.

Related notes: [[Product Decisions]], [[Roadmap]], [[Testing and Deployment]]
