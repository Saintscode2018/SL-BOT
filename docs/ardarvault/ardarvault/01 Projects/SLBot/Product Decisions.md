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
- Roster has no title; its description begins `<emoji> <@&roleId> Roster`, with no separate `Team` field, and retains the effective limit, exact staff headings, player list, and readable team/server footer.
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

## 8. Stage 4B.1 movement decisions

- TM/ATM/PM always have a same-team active player membership and consume squad capacity.
- A staff-only end retains the player row; a full roster end also ends staff. History is never hard-deleted.
- Active staff consume roster capacity but are excluded from the ordinary Players presentation. Removing staff preserves the player/team role and removes the prior rank's configured global role.
- Active player and staff uniqueness are guild-wide, while staff slots are unique per team.
- Discord role feasibility and changes precede the repeated database validation/commit. Commit failure triggers precise compensation; compensation failure requires visible manual reconciliation.
- Transfer Market receives completed movement events. Audit remains for configuration changes. Announcement failure is non-critical after state completes.
- Staff Transfer Market messages use structured Appointment/Demotion cards and readable team-role titles without `@` because team names are not stored. The administrative actor appears in both body and readable username/avatar/timestamp footer.
- Signing messages use the structured `✅ Offer Accepted - TeamRole` design, show roster current/max and the current TM, and identify the player by readable username/avatar in the footer.
- Offer creation and acceptance reject signed users; acceptance rechecks capacity and adds no global staff role.
- Offer DMs use command-resolved readable role/guild metadata, four ordered fields with relative-only expiry, and ✅/❌ button emoji without changing persistent IDs.
- Confirmations are random, server-side, initiating-user scoped, two minutes long, atomic, restart-invalid, and require a fresh confirmation-time eligibility callback.
- Manage Roles/Administrator is necessary but hierarchy still applies. The bot stays above playable admin roles, TM/ATM/PM, team roles, and each target member; the server owner remains unmanageable.
- Live role inspection is force-refreshed before synchronization so a stale member cache cannot leave the previous global staff role assigned while committing staff removal.

## 9. Explicit exclusions

Stage 4B.1 does not register release/demand/promotion/demotion/folist or implement imports, role-derived offer source, retry queues, reconciliation, team-inactivation removal, free-form templates, or per-team aliases.

Related notes: [[Commands]], [[Architecture]], [[Roadmap]]
