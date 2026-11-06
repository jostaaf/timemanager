# SQLite server data layer

## Overview

The server accesses SQLite directly through `better-sqlite3`. There is no ORM
or query builder: each table module contains its SQL statements, while
`scripts/generate-db-types.py` reads the existing database schema and writes
the corresponding TypeScript record types.

The current database file, `database/timemanager.db`, is the schema source of
truth. The generated types provide compile-time checks for application code;
they do not validate arbitrary data at runtime.
See the [database model document](./database-model.md) for the complete table,
relationship, foreign-key, and index reference.

## Project layout

| Path | Responsibility |
| --- | --- |
| `database/timemanager.db` | SQLite database and current table definitions |
| `src/server/db/client.ts` | Opens and exports the shared synchronous connection |
| `src/server/db/types.ts` | Generated table, record, insert, and update types |
| `src/server/db/contact.ts` | CRUD statements for `contact` |
| `src/server/db/contact-socials.ts` | CRUD statements for `contact_socials` |
| `src/server/db/event.ts` | CRUD statements for `event` |
| `src/server/db/event-contacts.ts` | CRUD statements for `event_contacts` |
| `src/server/db/optimistic-update.ts` | Shared compare-and-update implementation |
| `src/server/db/contact-service.ts` | Atomic contact and social-record operations |
| `src/server/db/event-service.ts` | Atomic event and event-contact operations |
| `scripts/generate-db-types.py` | Reads SQLite metadata and regenerates `types.ts` |
| `scripts/migrate-002-relationships.py` | Safely applies relationship migration 002 |
| `database/migrations/` | Ordered SQL changes to an existing database |

## Database connection

`client.ts` opens one `better-sqlite3` connection that is shared by the table
modules. By default, it uses `database/timemanager.db` in the project. Set
`TIMEMANAGER_DB_PATH` to use another database file:

```sh
export TIMEMANAGER_DB_PATH=/path/to/timemanager.db
```

Set this environment variable when starting the application.
`better-sqlite3` is synchronous. Database functions return their results
directly rather than returning promises. SQLite and database errors are allowed
to propagate to the caller. The shared connection enables SQLite foreign-key
enforcement; any connection opened outside the application must enable it too.

## Relationships and aggregate operations

The database enforces these relationships:

- A contact may have zero or more `contact_socials` records. Each social record
  must reference an existing contact.
- `event` and `contact` are independent entities with a many-to-many
  relationship through `event_contacts`. An event may have no contacts or many
  contacts; a contact may have no events or be linked to many events. Each
  `event_contacts` row links exactly one existing event to one existing
  contact.
- Deleting a contact cascades only to its `contact_socials` and
  `event_contacts` rows. It never deletes an event. Deleting an event cascades
  only to its `event_contacts` rows; it never deletes a contact. These
  link-only cascades are performed by SQLite as part of the parent delete.

Use the aggregate service functions when creating a parent together with its
children:

- `createContactWithSocials(contact, socials)` creates the contact and all
  supplied social records in one transaction. Each social's `contact_key` is
  assigned from the new contact; callers do not provide it.
- `createEventWithContacts(event, contacts)` creates the event and all supplied
  contact links in one transaction. Each link's `event_key` is assigned from
  the new event; callers do not provide it. Every `contact_key` must refer to
  an existing contact.

If any insert fails, the transaction rolls back the parent and all children,
so no partial aggregate is saved. The lower-level child insert functions are
also protected by foreign keys. A parent delete uses the existing
version-checked delete function, with its cascade occurring atomically.

The previous `event_contacts` schema had no `event_key`, so existing link rows
cannot be assigned to an event automatically. Migration 002 refuses to run
while such rows exist rather than discarding or guessing their relationship.
Apply it once with:

```sh
npm run db:migrate:relationships
```

The migration preserves existing `contact_socials` and adds cascading
references to both parent tables. Back up the database before applying it.

## Generated record types

For each application table, `types.ts` exports:

- `<Table>Table`: the column names and TypeScript value types.
- `<Table>Record`: a row returned from the database.
- `New<Table>Record`: the shape accepted by the insert function.
- `<Table>Update`: optional changes for the update function, excluding `key`
  and `version`.

The generator reads column names, declared SQLite types, nullability, and
primary-key metadata using SQLite's schema tables and `PRAGMA table_info`.
Current type mapping:

| SQLite declared type | TypeScript type |
| --- | --- |
| Types containing `INT` | `number` |
| Types containing `CHAR`, `CLOB`, or `TEXT` | `string` |
| Types containing `REAL`, `FLOA`, or `DOUB` | `number` |
| Types containing `NUMERIC` or `DECIMAL` | `number \| string` |
| Types containing `BLOB`, or an empty type | `Uint8Array` |
| Other declared types | `number \| string` |

Nullable, non-primary-key columns are represented as a union with `null`.
SQLite's type system is flexible, so these TypeScript types are useful
application-level expectations, not runtime guarantees.

Do not edit `types.ts` by hand. Regenerate it with:

```sh
npm run db:types
```

The `check`, `build`, and `test` commands run the generator first. Python 3 and
the `sqlite3` Python module must be available for these commands.

## Tests

### Commands

| Command | Purpose | Writes to the project database? |
| --- | --- | --- |
| `npm run db:types` | Regenerate TypeScript types from the schema | No; generator opens the database read-only |
| `npm run check` | Regenerate types and type-check without emitting build output | No |
| `npm run build` | Regenerate types and compile TypeScript into `dist/` | No |
| `npm test` | Build the project, then run all database-layer tests | No |

Run the full test suite from the project root:

```sh
npm test
```

To run the tests without rebuilding (after `npm run build`), or to filter by a
test name, use Node's test runner directly:

```sh
node --test tests/*.test.mjs
node --test --test-name-pattern="optimistic locking" tests/db-layer.test.mjs
```

### Isolation and coverage

`npm test` runs `npm run build` first. The test file then opens
`database/timemanager.db` read-only and copies only its table and index
definitions into a new temporary database under the operating system's
temporary directory. It copies no rows. The application connection is pointed
at that temporary database for the duration of the tests. Inserts, updates,
deletes, relationship cascades, and rollback checks all run there. On normal
test completion, the connection is closed and the temporary directory is
removed.

The suite covers:

- Insert, update, and delete for all four tables.
- Optimistic-lock version increments, stale-version conflicts, and missing
  records for update and delete.
- Foreign-key rejection when a child references a missing parent.
- Atomic creation of a contact with socials and an event with contacts,
  including rollback when a child insert fails.
- Parent deletion cascading only to relationship rows, while leaving the
  other parent record intact.
- Contacts and events with no relationship rows.

The test command does not modify user data in `database/timemanager.db`.
It does regenerate `src/server/db/types.ts` and compile files under `dist/`.

## CRUD behavior

Each table module exports insert, update, and delete functions. Inputs and
returned rows use the generated record types. SQL values are passed as
parameters rather than interpolated into SQL text. Update column names come
from the typed update object's keys and are quoted as SQLite identifiers.

- **Insert** returns the inserted row. If SQLite does not return a row, the
  function throws.
- **Update** requires the row `key`, the `version` read with that row, and a
  partial record that cannot change either field. The database updates the row
  only if both key and version match. A successful update increments `version`
  by one and returns a discriminated result:
  - `{ status: "updated", record }` when the update succeeds.
  - `{ status: "conflict", currentVersion }` when the row exists but its version
    has changed. No changes are applied; fetch the latest row and resolve or
    retry the user's edit.
  - `{ status: "not_found" }` when no row has that key.
- The version comparison, update, and conflict check run in one SQLite
  transaction. An update with no changed fields checks the expected version
  and returns the current row without incrementing the version.
- **Delete** requires the row `key` and its `expectedVersion`. It deletes only
  when both match, and returns `{ status: "deleted", record }`. If the row
  exists at another version it returns
  `{ status: "conflict", currentVersion }`; if the key does not exist it returns
  `{ status: "not_found" }`. The version check, delete, and conflict check run
  in one SQLite transaction.
- **Insert** creates and returns the record. A missing row is not an insert
  outcome; insert failures such as a duplicate key are raised by SQLite and
  propagate to the caller.

The CRUD insert functions require all non-null fields, including `key` and
`version`. The `event_contacts` migration sets a database default of `1` for
existing rows and direct SQL inserts, but the typed insert function still
requires the caller to provide the initial version.

Example:

```ts
import {
  deleteContact,
  insertContact,
  updateContact,
} from "./server/db/contact.js";

const contact = insertContact({
  key: 1,
  version: 1,
  name: "Alex Example",
  street: "1 Example Street",
  postcode: 12345,
  city: "Example City",
  phone: null,
  email: null,
  tag: null,
  comment: null,
});

const result = updateContact(contact.key, contact.version, {
  phone: "555-0100",
});

if (result.status === "conflict") {
  console.log(`Contact changed; current version is ${result.currentVersion}`);
} else if (result.status === "updated") {
  console.log("New version:", result.record.version);
}

const versionToDelete =
  result.status === "updated" ? result.record.version : contact.version;
const deletion = deleteContact(contact.key, versionToDelete);
if (deletion.status === "not_found") {
  console.log("Contact no longer exists");
} else if (deletion.status === "conflict") {
  console.log(`Contact changed; current version is ${deletion.currentVersion}`);
}
```

## Changing the database schema

Schema changes are made through SQL migrations. Type generation does not create
or migrate tables; it reflects the schema already present in the database.

1. Add an ordered SQL migration under `database/migrations/` and a runner if
   the migration needs precondition checks.
2. Back up the database, then apply each migration once. The existing
   migrations can be applied with:

   ```sh
   sqlite3 database/timemanager.db < database/migrations/001_add_event_contacts_version.sql
   npm run db:migrate:relationships
   ```

3. Run `npm run db:types` to regenerate the record types.
4. If a table was added or renamed, add or rename its CRUD module and export the
   desired operations.
5. Update explicit SQL column lists in affected CRUD modules when columns were
   added, removed, or renamed.
6. Run `npm run check` and `npm run build`.

The generator discovers tables automatically, but it does not generate CRUD
modules or apply migrations automatically. Apply each migration exactly once
to every database environment and keep the schema version consistent.
