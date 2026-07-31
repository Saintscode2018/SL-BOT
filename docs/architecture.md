# Architecture

## Boundaries

Discord adapters translate interactions into plain service inputs. Services own workflows and transactions. Repositories own persistence operations. The domain, service, and repository layers use internal UUIDs, string snowflakes, domain values, dates, and plain typed objects; they do not import discord.js.

```text
discord adapters -> services -> repositories -> prisma -> sqlite
                         domain types and errors
```

## Application lifecycle

`createApplication` validates startup configuration and explicitly constructs the logger, Prisma client, repositories, services, Discord client, command registry, event registry, and command context. Construction does not connect to Discord. `Application.start` connects Prisma, registers definitions, and then logs in. A failed startup destroys Discord and disconnects Prisma while preserving the startup error as the cause of a typed error.

`Application.stop` is idempotent, waits for an in-progress startup attempt, destroys Discord, and disconnects Prisma. The entrypoint owns signal registration and shares one shutdown promise for `SIGINT`, `SIGTERM`, and startup failure. The lifecycle object never terminates the process itself.

## Discord registration

The client requests only the `Guilds` intent. Commands are explicit typed definitions in a static registry; duplicate names fail during construction and command JSON is available for future deployment. Events are also explicit typed definitions. No runtime filesystem scan, decorator, global dependency container, or automatic Discord command deployment is used.

The interaction event ignores non-chat-input interactions, resolves commands by name, logs unknown commands and internal failures, and returns only a generic ephemeral response using `reply` or `followUp` according to interaction state. No league command is registered in this stage.

## Relationships and history

A guild owns settings, clubs, memberships, offers, transactions, and audit events. Guild settings use a unique foreign key for a true one-to-one relationship. Memberships connect a user to a club and guild while retaining creation and ending actors. Transactions retain their subject, performer, clubs, offer reference, and reversal metadata. Club deactivation only changes `active`; it never deletes historical rows.

Historical foreign keys generally use restrictive deletion. Actor-like optional references use `SET NULL`, preserving the historical event when an optional actor is removed. Guild settings cascade with their guild because they are configuration rather than league history. Repository APIs intentionally expose no deletion operations in this stage.

## Domain values and SQLite

SQLite has no native enum type through the selected Prisma connector. Canonical values are declared once in `src/domain/enums.ts`, used to derive TypeScript unions and Zod schemas, and mirrored by migration-level `CHECK` constraints. This gives runtime, compile-time, and database validation without scattering manually maintained copies through repositories.

Discord snowflakes and Roblox user IDs are strings from input through storage. No layer converts them to JavaScript numbers.

## Conditional constraints

SQLite partial unique indexes enforce membership cardinality and pending-offer uniqueness. Prisma models cannot fully describe conditional indexes, so the reviewed migration SQL is authoritative. Tests apply the migration and query `sqlite_master` to verify those indexes exist.

Clubs expose a composite unique key over their internal ID and guild ID. Membership, offer, source-club, and destination-club relations reference that pair, preventing a valid club from another guild from being attached to the row. Migration-level checks also keep membership and offer timestamps consistent with their status.

Squad size is computed by counting active `PLAYER` memberships. The schema contains no mutable squad-size column.

## Repository injection and transactions

Each repository accepts a `PrismaClient` or `Prisma.TransactionClient`. The offer-acceptance service creates repositories over the transaction client passed to `$transaction`; offer transition, membership changes, league transaction, and audit event therefore share one rollback boundary. Repositories do not hide a global client.

State transitions use conditional writes. Offers transition only when the current status is `PENDING`; reversals update only unreversed transactions. A zero-row update is resolved into a typed not-found or invalid-state error. This prevents two concurrent callers from both claiming success.

## Guild configuration and offer acceptance

Guild configuration is loaded by Discord guild snowflake from `Guild`, `GuildSettings`, and active `Club` records. Missing records produce typed errors and are never synthesized from legacy constants.

Offer acceptance verifies the offered player identity, expiry, club activity, derived active-player count, and existing membership. A free agent creates a `SIGNING`; a player from another club ends the previous membership and creates a `TRANSFER`. The service rejects full squads, inactive clubs, terminal offers, wrong users, and players already active at the destination. It records an immutable `offer.accepted` audit event with player, source, destination, transaction, and membership state. Expiration is committed as `EXPIRED` without creating membership or transaction records.

## Migration policy

Every schema change receives a versioned Prisma migration. Custom checks and partial indexes belong in migration SQL. Tests and deployments use `prisma migrate deploy`; `prisma db push` is not part of the workflow.

The tracked `superleague.db` and root Python files are legacy-only. The inspection script opens a supplied database in read-only mode. Legacy import will be a separate reviewed project because identity mapping and incompatible roster/transaction semantics require explicit decisions.

## Future command flow

The next stage can add `/offer` metadata and interaction adapters above the existing services. Raw Prisma calls must remain outside command handlers. Discord roles and announcements should happen only after durable state transitions and require a documented recovery strategy for external side effects.
