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
| `src/server/application/` | Application use cases and business rules |
| `database/timemanager.db` | SQLite database and current table definitions |
| `src/server/db/client.ts` | Opens and exports the shared synchronous connection |
| `src/server/db/types.ts` | Generated table, record, insert, and update types |
| `src/server/db/contact.ts` | CRUD statements for `contact` |
| `src/server/db/contact-socials.ts` | CRUD statements for `contact_socials` |
| `src/server/db/event.ts` | CRUD statements for `event` |
| `src/server/db/event-contacts.ts` | CRUD statements for `event_contacts` |
| `src/server/db/note.ts` | CRUD statements and validation for `note` |
| `src/server/db/note-links.ts` | Version-checked many-to-many note assignments |
| `src/server/db/optimistic-update.ts` | Shared compare-and-update implementation |
| `src/server/db/delete-parent.ts` | Parent deletion and linked-note version updates |
| `src/server/db/contact-service.ts` | Atomic contact and social-record operations |
| `src/server/db/event-service.ts` | Atomic event and event-contact operations |
| `scripts/generate-db-types.py` | Reads SQLite metadata and regenerates `types.ts` |
| `scripts/migrate-002-relationships.py` | Safely applies relationship migration 002 |
| `scripts/migrate-003-notes.py` | Applies the note-table migration |
| `database/migrations/` | Ordered SQL changes to an existing database |

## Application layer

Application use cases live in `src/server/application/` and express user-level
operations using the lower-level database modules. They contain business rules
that should not be embedded in the database schema.

`events/add-contact-to-event.ts` implements `addContactToEvent`. It checks that
the event and contact exist, then checks whether the pair is already linked.
It returns `added`, `already_assigned`, `event_not_found`, or
`contact_not_found`. A duplicate returns the existing relationship without
inserting another row. The check and insert run in an immediate transaction,
so simultaneous application requests cannot both pass the duplicate check.
The relationship key is supplied by the caller, consistent with the existing
application-provided key model.

Contact aggregate use cases are in `contacts/`:

- `listContactsMatching` lists all contacts or filters by any combination of
  name, street address, postcode, and city. Non-empty criteria use
  case-insensitive substring matching and are combined with AND. `%`, `_`,
  and `!` in a search value are treated literally.
- `listContactsBySocialMedia("Instagram")` returns each contact with at least
  one matching social-media record. Platform matching ignores case and
  surrounding whitespace; contacts with multiple matching accounts appear
  only once.
- `createContactWithSocials` creates a contact and its supplied social records
  atomically. Social records are assigned to the new contact by the use case.
- `updateContactWithSocials` updates contact fields and applies a batch of
  social additions, updates, and deletions atomically. The contact and each
  existing social use optimistic version checks. It returns explicit
  `contact_not_found`, `contact_conflict`, `social_not_found`, or
  `social_conflict` outcomes when applicable. A social record must belong to
  the contact being updated.
- `deleteContactWithSocials` deletes the contact using its expected version.
  The existing database layer cascades deletion of its social records and
  event-contact links while preserving events and linked notes.

These multi-record operations run in immediate transactions; if an insert
fails with a SQLite error, all changes in that operation roll back.

Event aggregate use cases are in `events/`:

- `listAllEvents` returns all events ordered by start time, end time, and key.
- `listEventsInRange(fromInclusive, toExclusive)` selects events by their start
  time in a half-open range. `listUpcomingEvents(fromInclusive)` selects events
  starting at or after the given time (defaults to the current time).
- `searchEventsByName` performs a case-insensitive substring search.
- `listEventsForContact` returns the events linked to a contact.
- `listEventsWithContacts` returns each event once with its contacts and their
  event roles; events without contacts have an empty `contacts` array.
- `listEventsWithoutContacts` returns events with no contact links.
- Time-based listing inputs must be canonical UTC ISO-8601 timestamps in
  `YYYY-MM-DDTHH:mm:ss.sssZ` format. Event creation and updates through the
  application layer validate the same format so text ordering is chronological.

- `createEventWithContacts` creates an event and its initial contact links
  atomically. It checks contacts exist and rejects duplicate contact keys
  before inserting the event.
- `updateEventWithContacts` updates event fields and applies a batch of link
  additions, role updates, and deletions atomically. Event and existing links
  use optimistic version checks. It reports missing contacts or links,
  version conflicts, duplicate link changes, and duplicate contact assignments
  with explicit statuses.
- `deleteEventWithContacts` deletes the event using its expected version. The
  database cascades deletion of its event-contact links and preserves contacts;
  linked note versions are maintained by the database-layer delete operation.

Event-contact uniqueness is an application rule, not a database constraint.
Use these event use cases to prevent duplicate assignments; direct
database-layer inserts can still create duplicate event/contact pairs.
Database foreign keys continue to protect referential integrity.

Note use cases are in `notes/`:

- `createNote` creates a standalone note or creates it with optional contact
  and event assignments. It checks parent existence and duplicate keys before
  inserting, and creates the note and assignments atomically.
- `updateNoteWithAssignments` updates note content and optionally replaces the
  complete contact and/or event assignment lists. Omitted assignment lists
  remain unchanged; empty lists remove all links. Updates use the expected note
  version and return explicit missing-note, version-conflict, duplicate-key,
  or missing-parent outcomes.
- `deleteNoteWithAssignments` deletes a note using its expected version.
  Foreign-key cascades remove assignment rows only; contacts and events remain.

Assignment changes increment the note version through the note-link operations.
The database-generated creation timestamp is not editable through the
application use case.

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
- A note must have nonblank heading and text. Its creation timestamp is
  assigned by SQLite. A note may exist independently and can link to zero or
  more contacts and zero or more events. Deleting a linked parent removes only
  that relationship and increments the note version in the application delete
  transaction; the note and its other links are preserved.

Use `linkNoteToContact`, `unlinkNoteFromContact`, `linkNoteToEvent`, and
`unlinkNoteFromEvent` from `note-links.ts` to change note assignments. Each
operation requires the note's expected version and increments it if a link
changes. They return `updated`, `unchanged`, `conflict`, or `not_found`. Duplicate
links and removal of a nonexistent link return `unchanged`. Use
`listContactsForNote` and `listEventsForNote` to read related keys, or
`listNotesForContact` and `listNotesForEvent` to retrieve linked note records.

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

Migration 003 adds the `note` table and its content checks. For an existing
database being upgraded from before notes, apply it with:

```sh
npm run db:migrate:notes
npm run db:types
```

Migration 004 moves the former optional single `event_key` and `contact_key`
values into the `note_events` and `note_contacts` join tables, preserving
existing note assignments and note content. Apply it after migration 003:

```sh
npm run db:migrate:note-links
npm run db:types
```

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

- Insert, update, and delete for every table, including note CRUD and note links.
- Optimistic-lock version increments, stale-version conflicts, and missing
  records for update and delete.
- Foreign-key rejection when a child references a missing parent.
- Atomic creation of a contact with socials and an event with contacts,
  including rollback when a child insert fails.
- Parent deletion cascading only to relationship rows, while leaving the
  other parent record intact.
- Contacts and events with no relationship rows.
- Note creation, content validation, multiple contact/event links,
  version-checked link changes, and note preservation after deleting linked
  contacts or events.

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
- Note updates also cannot change `created_at`; heading and text must remain
  nonblank. A note that has become unassigned because its parents were deleted
  remains editable.
- **Delete** requires the row `key` and its `expectedVersion`. It deletes only
  when both match, and returns `{ status: "deleted", record }`. If the row
  exists at another version it returns
  `{ status: "conflict", currentVersion }`; if the key does not exist it returns
  `{ status: "not_found" }`. The version check, delete, and conflict check run
  in one SQLite transaction.
- **Insert** creates and returns the record. A missing row is not an insert
  outcome; insert failures such as a duplicate key are raised by SQLite and
  propagate to the caller.

The CRUD insert functions require all non-null fields that do not have a
database default, including `key`. `event_contacts` and `note` start at version
`1` using their database defaults. `insertNote` generates `created_at` in
SQLite and accepts `key`, `heading`, `text`, and an optional `event_key`,
`contact_key`, or both; both assignments may be omitted. Any supplied parent
must exist. Whitespace-only headings and text are rejected in both the API and
database.
The note update function uses the same optimistic-locking behavior as the
other tables and does not allow changes to `created_at`.

When the application deletes a contact or event, it increments versions of
notes whose corresponding parent reference is cleared. This code runs in the
same transaction as the parent delete. Notes remain editable even if both
parents have since been deleted. Direct SQL parent deletion also removes
matching note-link rows through foreign-key cascades, but bypasses the
application's note-version increments; perform deletes through the table
modules to preserve optimistic-locking behavior.

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
