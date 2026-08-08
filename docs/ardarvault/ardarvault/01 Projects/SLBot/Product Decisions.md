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
- `/team remove` is removed from the public slash-command surface. `/team disband team` is the confirmed permanent league-disbandment workflow.

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
- `/roster view team:<team>` replaces standalone `/roster team:<team>`. The view has no title; its description begins `<emoji> <@&roleId> Roster`, with no separate `Team` field, and retains the effective limit, exact staff headings, player list, and readable team/server footer.
- `/roster add player:<user> team:<team>` and `/roster remove player:<user>` are immediate Staff Commands-only operations for database `BOTPERM`/`BOTPERM_ADMIN` holders. Add requires a non-bot free agent without active staff and enforces effective capacity. Remove derives one ordinary active player team and never removes staff appointments.
- Players use only an active `PLAYER` membership and the team-specific Discord role; there is no global Player role. Role-first/database-second compensation applies, unrelated roles are preserved, and Audit + Transfer publishing is deferred to the next hotfix.
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
- Presentation foundation is centralized under `src/bot/presentation/` (`BOT_EMOJIS`, `BOT_LABELS`, `BOT_COLORS`, `timestamps.ts`, `users.ts`, `roles.ts`, `blockquotes.ts`, `authors.ts`, `footers.ts`). Canonical emojis replace conflicting historical usages (`👑` for Team Manager, `🧠` for Player Manager, `⚡` for Bot Permissions, `📊` for Roster, `⏰` for Expiry). Global cosmetic pass is deferred.

## 9. Stage 4B.2 demand and release decisions

- `/demand` has no options, runs only in Bot Commands or Staff, is always ephemeral except the final Transfer Market success, and uses a fixed one-minute in-memory per-guild/user anti-spam window. Only an allowed acquisition stores a new expiry; blocked retries report the decreasing remainder without extension, wrong-channel attempts do not consume or refresh it, and restart clears it.
- Ordinary players may demand fully. ATM/PM may leave only staff and remain as an ordinary player, or leave the team fully. TM cannot demand and must be removed/replaced administratively.
- `/release player` has no team/reason/mode option, runs only in Bot Commands or Staff, has no cooldown, derives the team from the caller's active staff row, and provides no global-permission or Administrator bypass.
- Release hierarchy is TM > ATM > PM > ordinary player. TM cannot be released, self-release is forbidden, and the target must be a current member of the caller's exact team. The target never confirms and receives no DM.
- Staff-only demand keeps the player row/team role and removes only the matching ATM/PM role. Full demand/release ends player and staff rows historically and removes only the affected team/staff roles. No hard delete, unrelated role change, or departure Audit event occurs.
- Confirmation state is initiator/guild/action/team/target/rank-bound for exactly two minutes, consumes atomically, is restart-invalid, and rechecks current membership, rank, team, and forced Discord feasibility.
- Non-admin/team-user and informational commands use Bot Commands or Staff; admin/configuration commands use Staff only. The selection is subcommand-aware, channel access never grants command authority, and Transfer Market/Audit remain output-only bot-operation channels. Wrong-channel errors use exact normalized wording (`Use this command in <channel list>.`). Non-global callers (including TM/ATM/PM callers without global administrative authorization) see channel guidance mentioning only Bot Commands (`Use this command in <#botCommandsChannelId>.`); Staff Commands is never disclosed to non-global callers. Unauthorized callers on STAFF_ONLY commands receive `Permission Denied` without channel guidance.
- Full demand uses `📣 Demand - TeamRole` and exactly two adjacent blockquote lines; release uses `🚪 Release - TeamRole` and exactly three adjacent lines with post-mutation roster/current TM while never revealing the acting manager. Both titles fall back to `Team`. Staff-only demand uses `stepped down to player` wording. Delivery failure is non-critical after completed state.

## 10. Stage 4B.3 promotion and demotion decisions

- `/promote player rank` and `/demote staff` provide team-controlled staff management.
- Authorization requires an active team staff appointment (TM/ATM for promote; TM for demote). Discord Administrators or Bot Permission holders without an active staff appointment cannot execute these commands (no administrative bypass).
- Allowed promotion paths: TM (Player -> PM, Player -> ATM, PM -> ATM) and ATM (Player -> PM). ATM promoting to ATM or PM to ATM is blocked. No Team Manager choice is registered or allowed.
- Allowed demotion paths: TM callers may demote ATM or PM targets back to ordinary player.
- Self-action (self-promotion, self-demotion), free agents, other-team members, TM targets, occupied destination slots, and targets already at the desired rank are rejected.
- Confirmations are ephemeral, 2 minutes long, initiator-only, and recheck caller/target state.
- Roster membership and team role are retained; roster count remains unchanged. Global staff roles (`TM`, `ATM`, `PM`) are synchronized. Historical staff appointments are preserved.
- Output cards (`⬆️ Promotion - TeamRole` / `⬇️ Demotion - TeamRole`) publish strictly to Transfer Market with server author/icon, team color/thumbnail, single blockquote panel, roster line, TM line, actor footer with avatar and UTC timestamp. No Audit channel delivery.

## 11. Stage 4C.2 team disbandment decisions

- `/team disband team:<team>` is global-admin-only, Staff Commands-only, ephemeral, and requires a two-minute initiator-owned confirmation. It has no reason option.
- Every active player/staff row ends historically. Every affected user loses the team-specific role; TM/ATM/PM users additionally lose only their matching configured global role. There is no global Player role.
- Related pending offers expire. Terminal and unrelated offers remain unchanged. The team row becomes inactive but its Discord role ID, emoji, users, transactions, audits, and all historical records remain.
- Role work remains role-first/database-second. Multi-member application deduplicates users/roles and compensates earlier removals on later failure; database failure compensates the whole applied batch. Compensation failure is logged and surfaced.
- Successful disbandment writes a `team.disbanded` audit containing guild/team/role/actor/count/timestamp metadata. It does not delete or mutate the Discord team role or emoji and makes no public announcement.

## 12. Explicit exclusions

Stage 4C.2 does not implement release reasons, target confirmation/DMs, demand counts/gameplay limits, general offer cancellation, imports, role-derived offer source, retry queues, reconciliation, free-form templates, or per-team aliases.

Related notes: [[Commands]], [[Architecture]], [[Roadmap]]
