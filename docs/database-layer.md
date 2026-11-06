# SQLite server data layer

## Overview

The server accesses SQLite directly through `better-sqlite3`. There is no ORM
or query builder: each table module contains its SQL statements. The canonical
current schema is `database/schema.sql`; it initializes new databases and is
the input used to generate the corresponding TypeScript record types.

The generated types provide compile-time checks for application code; they do
not validate arbitrary data at runtime. `database/timemanager.db` is a local
database, not the schema source of truth.
See the [database model document](./database-model.md) for the complete table,
relationship, foreign-key, and index reference.

## Project layout

| Path | Responsibility |
| --- | --- |
| `src/server/application/` | Application use cases and business rules |
| `database/schema.sql` | Canonical current schema for fresh databases |
| `database/timemanager.db` | Local SQLite database; initialize with `npm run db:init` |
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
| `scripts/initialize-database.py` | Safely initializes a new database from `schema.sql` |
| `scripts/generate-db-types.py` | Generates `types.ts` from an in-memory schema database |

The baseline represents the current development schema. Initialize a new
database with `npm run db:init`; set `TIMEMANAGER_DB_PATH` to choose a
different file. The initializer creates a database only if it has no schema
objects. If the file already has a schema, it verifies an exact match to the
baseline and refuses to modify mismatched databases.

Tests create an isolated temporary database from `database/schema.sql`, and
type generation uses the same file. Thus neither tests nor builds depend on
the contents or schema of the local database file. For future schema work,
update this baseline for fresh installs and add a forward migration for
databases already initialized from it; a migration runner should be introduced
before applying such future migrations to existing user databases.

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
  name, street address, zip, city, phone, email, tag, social platform,
  and/or social user ID. Non-empty text criteria use case-insensitive
  substring matching and are combined with AND. Social platform matching is
  exact and case-insensitive. `%`, `_`, and `!` in search values are treated
  literally.
- Contact listings accept optional `sortBy`, `sortDirection`, `limit`, and
  `offset` options. Sorting is allowlisted and uses the contact key as a
  stable tie-breaker. Pagination values must be non-negative integers.
- `listContactsBySocialMedia("Instagram")` returns each contact with at least
  one matching social-media record. Platform matching ignores case and
  surrounding whitespace; contacts with multiple matching accounts appear
  only once.
- `listContactsWithSocials(criteria, options)` returns `{ contact, socials }`
  for each matching contact. The socials list includes all of that contact's
  social records, even when the criteria matched only one platform.
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

- `listAllNotes` returns all notes newest first.
- `searchNotes` searches heading or body text with a case-insensitive,
  literal substring match.
- `listNotesCreatedInRange(fromInclusive, toExclusive)` selects notes in a
  half-open range using canonical UTC ISO-8601 timestamps.
- `listUnassignedNotes` returns notes with neither contact nor event links.
- `listNotesForContactKey` and `listNotesForEventKey` return assigned notes,
  newest first.
- `listNotesForContactAndEvent` returns notes linked to both the specified
  contact and event.
- `createNote` creates a standalone note or creates it with optional contact
  and event assignments. It checks parent existence and duplicate keys before
  inserting, generates `created_at` in application code as a UTC ISO-8601
  timestamp (`YYYY-MM-DDTHH:mm:ss.sssZ`), and creates the note and assignments
  atomically.
- `updateNoteWithAssignments` updates note content and optionally replaces the
  complete contact and/or event assignment lists. Omitted assignment lists
  remain unchanged; empty lists remove all links. Updates use the expected note
  version and return explicit missing-note, version-conflict, duplicate-key,
  or missing-parent outcomes.
- `deleteNoteWithAssignments` deletes a note using its expected version.
  Foreign-key cascades remove assignment rows only; contacts and events remain.

Assignment changes increment the note version through the note-link operations.
The application-generated creation timestamp is not editable through the
application use case. The database has no default for `created_at`, so inserts
must supply the timestamp.

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
  generated by application logic. A note may exist independently and can link to zero or
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

The current relationships and constraints are defined in the canonical
`database/schema.sql` baseline. This project has no older installations to
upgrade, so historical migration files and runners are not part of setup.

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
`1` using their database defaults. The application `createNote` use case
generates the required `created_at` timestamp in canonical UTC ISO-8601 format;
the database has no timestamp default. Note assignments are created through
the application use case and its note-link operations. Whitespace-only
headings and text are rejected in both the API and database. The note update
function uses the same optimistic-locking behavior as the other tables and
does not allow changes to `created_at`.

When the application deletes a contact or event, it increments versions of
notes whose corresponding join-table links are removed. This code runs in the
same transaction as the parent delete. Notes remain editable even after all
their parents have been deleted. Direct SQL parent deletion also removes
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
  zip: "01234",
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

The project currently uses `database/schema.sql` as the complete schema
baseline; there is no migration history or migration runner. For schema
changes, update the baseline, run `npm run db:init` for a fresh database,
regenerate types with `npm run db:types`, and update the affected CRUD modules
and tests. The initializer deliberately refuses to change a database that
already has a non-matching schema. Before the app needs to upgrade existing
databases, add a forward-migration mechanism and corresponding migrations.
