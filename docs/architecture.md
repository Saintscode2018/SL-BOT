# Architecture

## Boundaries

Discord adapters will translate interactions into plain service inputs. Services will own workflows and transactions. Repositories own persistence operations. The domain and repository layers use internal UUIDs, string snowflakes, domain values, dates, and plain typed objects; they do not import discord.js.

```text
future discord adapters -> future services -> repositories -> prisma -> sqlite
                                      domain types and errors
```

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

Each repository accepts a `PrismaClient` or `Prisma.TransactionClient`. A future service can create repositories over the transaction client passed to `$transaction`, perform a multi-step workflow, and allow any failure to roll back all writes. Repositories do not hide a global client.

State transitions use conditional writes. Offers transition only when the current status is `PENDING`; reversals update only unreversed transactions. A zero-row update is resolved into a typed not-found or invalid-state error. This prevents two concurrent callers from both claiming success.

## Migration policy

Every schema change receives a versioned Prisma migration. Custom checks and partial indexes belong in migration SQL. Tests and deployments use `prisma migrate deploy`; `prisma db push` is not part of the workflow.

The tracked `superleague.db` and root Python files are legacy-only. The inspection script opens a supplied database in read-only mode. Legacy import will be a separate reviewed project because identity mapping and incompatible roster/transaction semantics require explicit decisions.

## Future command flow

The next stage can introduce a thin Discord startup and command adapter layer, service methods for offer acceptance, and transaction-scoped repository composition. Raw Prisma calls must remain outside command handlers. Discord roles and announcements should happen only after durable state transitions and require a documented recovery strategy for external side effects.
