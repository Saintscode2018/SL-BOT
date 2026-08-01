---
title: SL Bot Product Decisions
type: product-decisions
tags:
  - slbot
  - decisions
  - rules
---

# Locked Long-Term Product Decisions

Index: [[SLBot]] | Architecture: [[Architecture]]

## 1. Database Authority

- Database membership is **authoritative**.
- Discord roles reflect database state, but manual Discord role edits do not silently rewrite official league history.

## 2. Staff Structure

- Each club may appoint up to:
  - **1 Team Manager (TM)**
  - **1 Assistant Team Manager (ATM)**
  - **1 Player Manager (PM)**
- Staff appointments do **not** count toward squad player limits.
- A staff member counts as a player only when they hold an active `PLAYER` membership.

## 3. Squad Limit Model

- Guild-wide default squad limit is **17**.
- Optional per-club override (`squadLimitOverride`).
- Effective limit resolution:
  $$\text{Effective Limit} = \text{squadLimitOverride} \mathbin{??} \text{defaultSquadLimit}$$
- Derived dynamically via `getEffectiveSquadLimit(club, settings)`.

## 4. System Channels

- **Bot Commands Channel**: Dedicated for public informational commands (`/team list`, `/staff list`, `/roster`, `/limit view`).
- **Staff Channel**: Dedicated for administration and mutation commands (`/setup`, `/team add/edit`, `/limit default/team/reset`, `/offer create`, `/staff appoint/remove`).
- **Transfer Channel**: Reserved for future public contract signing and transfer announcements.
- **Audit Channel**: Reserved for future system audit logging.

## 5. Private Contract Offers

- Offers are delivered exclusively via **private Direct Messages (DMs)** to the target player.
- Pending offers contain persistent **Sign Contract** and **Decline Offer** buttons.
- Contract card displays destination club, offering manager, current squad count, effective limit, remaining spaces, and expiry date.

Related notes: [[Commands]], [[Roadmap]]
