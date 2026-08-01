---
title: SL Bot Product Decisions
type: decisions
tags:
  - slbot
  - decisions
  - stage4a
---

# Locked Long-Term Product Decisions

## 1. Permanent team identity

- A team is only its required emoji plus required Discord role.
- There is no team display name, abbreviation, or configurable presentation format.
- Discord is the source of readable role names; the database does not copy them.
- Internal `Club.id` is the stable identity for autocomplete values and relations.

## 2. Commands

- Add: `/team add role emoji`.
- Edit: `/team edit team [role] [emoji]`, with at least one change.
- The removed `/bannerconfig` command and its settings do not return.
- `/team remove` remains soft deactivation; full disband behavior is deferred.

## 3. Formatter and autocomplete

- Every team display uses `formatTeamIdentity(team, mode)`.
- Message custom emoji are canonical mentions; roles are `<@&roleId>`.
- Titles use `<emoji> @RoleName`; footers use Unicode or `.name.` plus `@RoleName`.
- Autocomplete is role-only and uses cached `@RoleName`.
- Unresolved roles use `Unknown Team Role`; raw IDs are prohibited.
- Autocomplete values remain club IDs and labels stay within 100 characters.

## 4. Conflicts and staff

- Duplicate Discord role is the only team-identity uniqueness conflict.
- A user has at most one active staff appointment in a guild.
- A team has at most one active TM, ATM, and PM.
- Staff success and conflict messages use friendly positions and complete team identity.

## 5. Roster and lists

- Team list is one `identity — current/max` line per team.
- Staff list is one normal-text identity followed by vertical TM/ATM/PM lines with `Vacant`.
- Roster uses `<emoji> @RoleName Roster`, no separate `Team` field, effective limit, exact staff headings, player list, and a footer containing the readable identity plus server name.
- Single-team thumbnails are emoji-derived.
- Single-team embeds use the nonzero cached Discord role color; missing/zero colors use the existing fallback. Role colors are not persisted.

## 6. Offer source

- `/offer player` derives `Source Team` from the caller's active database staff appointment.
- Active staff targets remain ineligible until removed.
- Acknowledgement names the target, issuing actor, and source team in that order; it is ephemeral and the contract is a private DM with no public follow-up.
- Discord-role source derivation and synchronization are deferred.

## 7. Setup and audit boundary

- Setup view is ephemeral, read-only, unaudited, and shows channels, roles, settings, and missing configuration.
- Setup league/channels/roles publish best-effort audit embeds after persistence.
- Team, limit, staff, and debug-reset Discord auditing is not added in Stage 4A.

## 8. Explicit exclusions

No role synchronization, imports, transfers, release/demand, promotion/demotion, free-form templates, per-team aliases, or Stage 4B commands are implemented here.

Related notes: [[Commands]], [[Architecture]], [[Roadmap]]
