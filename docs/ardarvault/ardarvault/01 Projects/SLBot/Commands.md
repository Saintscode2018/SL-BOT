---
title: SL Bot Command Tree & Visibility
type: commands-reference
tags:
  - slbot
  - commands
  - discord
---

# Command Architecture & Visibility Matrix (Stage 4A Polish Updated)

Index: [[SLBot]] | Architecture: [[Architecture]]

> [!IMPORTANT]
> Supersedes previous Stage 4A matrix per Stage 4A Polish product decisions. All responses are Discord embeds with `✅` success or `❌` error titles. Mutation embeds feature an explicit actor line at the bottom.

## Stage 4A Polish Command Tree

```
/setup
  ├── league          (Inputs: [offer_timeout_minutes])
  ├── channels        (Inputs: bot_commands, staff, transfer, audit)
  ├── roles           (Inputs: bot_permissions, team_manager, assistant_manager, player_manager)
  └── view            (Displays league configuration & missing settings)

/team
  ├── add             (Inputs: name, short_name, role, emoji [required])
  ├── edit            (Inputs: team, [name], [short_name], [role], [emoji])
  ├── remove          (Inputs: team) - Safe soft deactivation preserving historical records (distinguished from future /disband)
  └── list            (Displays active teams with custom/unicode emojis, counts, limits, remaining spaces)

/limit
  ├── default         (Inputs: amount 1-100)
  ├── team            (Inputs: team, amount 1-100)
  ├── reset           (Inputs: team)
  └── view            (Inputs: [team])

/staff
  ├── appoint         (Inputs: team, user, staff_type)
  ├── remove          (Inputs: team, staff_type)
  └── list            (Inputs: [team])

/roster               (Inputs: team) - Team Manager, Assistant Team Manager, Player Manager, divider, Players

/offer                (Inputs: player) - Automatically derives source team from caller's active TM/ATM/PM appointment

/health               (Check bot & DB status ephemerally: Online ✅, Connected ✅)

/debugreset           (Development-only reset whose buttons accept only the initiating Discord Administrator)
```

## Response Visibility & Channel Matrix

| Command           | Allowed Channels                               | Authorization                 | Response Visibility                        |
| :---------------- | :--------------------------------------------- | :---------------------------- | :----------------------------------------- |
| `/health`         | Bot Commands; Staff for global callers         | Normal bot user               | **Ephemeral Embed**                        |
| `/setup league`   | Staff channel only (Bootstrap exception below) | Global bot permission         | **Ephemeral Embed**                        |
| `/setup channels` | Staff channel only (Bootstrap exception below) | Global bot permission         | **Ephemeral Embed**                        |
| `/setup roles`    | Staff channel only (Bootstrap exception below) | Global bot permission         | **Ephemeral Embed**                        |
| `/setup view`     | Staff channel only (Bootstrap exception below) | Global bot permission         | **Ephemeral Embed**                        |
| `/team add`       | Staff channel only                             | Global bot permission         | **Ephemeral Embed**                        |
| `/team edit`      | Staff channel only                             | Global bot permission         | **Ephemeral Embed**                        |
| `/team remove`    | Staff channel only                             | Global bot permission         | **Ephemeral Embed**                        |
| `/team list`      | Bot Commands; Staff for global callers         | Normal bot user               | **Public Embed**                           |
| `/limit default`  | Staff channel only                             | Global bot permission         | **Ephemeral Embed**                        |
| `/limit team`     | Staff channel only                             | Global bot permission         | **Ephemeral Embed**                        |
| `/limit reset`    | Staff channel only                             | Global bot permission         | **Ephemeral Embed**                        |
| `/limit view`     | Bot Commands; Staff for global callers         | Normal bot user               | **Public Embed**                           |
| `/staff appoint`  | Staff channel only                             | Global bot permission         | **Ephemeral Embed**                        |
| `/staff remove`   | Staff channel only                             | Global bot permission         | **Ephemeral Embed**                        |
| `/staff list`     | Bot Commands; Staff for global callers         | Normal bot user               | **Public Embed**                           |
| `/roster`         | Bot Commands; Staff for global callers         | Normal bot user               | **Public Embed**                           |
| `/offer`          | Bot Commands OR Staff                          | Active Club Staff (TM/ATM/PM) | **Public Embed Ack** (DM to target player) |
| `/debugreset`     | Staff channel only                             | Discord Administrator ONLY    | **Ephemeral Confirmation Embed & Buttons** |

### Bootstrap Exception Rules

- Before `staff` channel or `bot_permissions` role is configured, a Discord **Administrator** may execute setup commands in the current channel.
- Once configured, setup commands MUST be run in the `staff` channel.
- Ordinary users never receive bootstrap access.

All error responses and channel policy violations produce **ephemeral red error embeds** (`❌`).

Ordinary informational callers are directed only to Bot Commands. Globally authorized callers may receive Bot Commands and Staff guidance when both are configured. Administrative permission is checked before Staff details are revealed. `/offer` validates Bot Commands or Staff before resolving the caller's active TM/ATM/PM appointment.

Team labels use `<emoji> Name (SHORT)`; custom emoji autocomplete labels use `:name: Name (SHORT)` while the choice value remains the club ID. Successful setup league/channels/roles mutations mirror to the configured audit channel; setup view and all other administrative mutations do not publish Discord audit messages in this stage.

Related notes: [[Product Decisions]], [[Roadmap]], [[Testing and Deployment]]
