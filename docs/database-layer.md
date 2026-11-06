# SQLite server data layer

## Overview

The server accesses SQLite directly through `better-sqlite3`. There is no ORM
or query builder: each table module contains its SQL statements, while
`scripts/generate-db-types.py` reads the existing database schema and writes
the corresponding TypeScript record types.

The current database file, `database/timemanager.db`, is the schema source of
truth. The generated types provide compile-time checks for application code;
they do not validate arbitrary data at runtime.

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
| `scripts/generate-db-types.py` | Reads SQLite metadata and regenerates `types.ts` |
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
to propagate to the caller.

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

Both `npm run check` and `npm run build` run the generator first. Python 3 and
the `sqlite3` Python module must be available for these commands.

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

1. Add an ordered SQL file under `database/migrations/`.
2. Back up the database, then apply each migration once with SQLite. For the
   current version-column migration:

   ```sh
   sqlite3 database/timemanager.db < database/migrations/001_add_event_contacts_version.sql
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
