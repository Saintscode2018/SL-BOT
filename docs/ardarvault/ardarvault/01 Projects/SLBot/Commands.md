---
title: SL Bot Command Tree & Visibility
type: commands-reference
tags:
  - slbot
  - commands
  - discord
---

# Command Architecture & Visibility Matrix

Index: [[SLBot]] | Architecture: [[Architecture]]

## Stage 4A Target Command Tree

```
/setup
  ├── guild           (Inputs: offer_timeout_minutes)
  ├── channels        (Inputs: bot_commands, staff, transfer, audit)
  ├── roles           (Inputs: league_admin, team_manager, assistant_manager, player_manager)
  └── view            (Displays configuration & missing settings)

/team
  ├── add             (Inputs: name, short_name, role, [logo_url], [emoji])
  ├── edit            (Inputs: team, [name], [short_name], [role], [logo_url], [emoji])
  └── list            (Displays active teams, counts, limits, remaining spaces)

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

## Response Visibility Matrix

| Command           | Allowed Channel                             | Response Visibility                           |
| :---------------- | :------------------------------------------ | :-------------------------------------------- |
| `/health`         | Any channel                                 | **Ephemeral**                                 |
| `/setup guild`    | Staff channel (or anywhere if unconfigured) | **Ephemeral**                                 |
| `/setup channels` | Staff channel (or anywhere if unconfigured) | **Ephemeral**                                 |
| `/setup roles`    | Staff channel (or anywhere if unconfigured) | **Ephemeral**                                 |
| `/setup view`     | Staff channel (or anywhere if unconfigured) | **Ephemeral**                                 |
| `/team add`       | Staff channel                               | **Ephemeral**                                 |
| `/team edit`      | Staff channel                               | **Ephemeral**                                 |
| `/team list`      | Bot Commands channel                        | **Public**                                    |
| `/limit default`  | Staff channel                               | **Ephemeral**                                 |
| `/limit team`     | Staff channel                               | **Ephemeral**                                 |
| `/limit reset`    | Staff channel                               | **Ephemeral**                                 |
| `/limit view`     | Bot Commands channel                        | **Public**                                    |
| `/staff appoint`  | Staff channel                               | **Ephemeral**                                 |
| `/staff remove`   | Staff channel                               | **Ephemeral**                                 |
| `/staff list`     | Bot Commands channel                        | **Public**                                    |
| `/roster`         | Bot Commands channel                        | **Public**                                    |
| `/offer create`   | Staff channel                               | **Ephemeral** (Delivers private DM to player) |

All error responses and channel restriction warnings are strictly **ephemeral**.

Related notes: [[Product Decisions]], [[Roadmap]], [[Testing and Deployment]]
