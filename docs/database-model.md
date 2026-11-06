# Database model

This document describes the SQLite schema in `database/timemanager.db`.
It reflects the schema after migrations 001, 002, 003, 004, and 005.

## Entity relationship summary

```text
contact  1 ───── 0..* contact_socials

contact  1 ───── 0..* event_contacts 0..* ───── 1 event
                       (join table)

contact  0..* ───── 0..* note_contacts 0..* ───── 1 note
event    0..* ───── 0..* note_events   0..* ───── 1 note
```

- A contact may exist without social profiles, and a social profile must belong
  to exactly one existing contact.
- An event and a contact are independent entities. Either may exist without
  any event/contact relationship.
- `event_contacts` implements the many-to-many relationship: each row connects
  one event to one contact. A contact may be linked to a given event at most
  once.
- Notes may be standalone or link to zero or more contacts and zero or more
  events. The links are represented by `note_contacts` and `note_events`.
- Deleting a contact or event removes only its rows from the respective note
  join table. The note and any links to other parents remain.
- Deleting a contact deletes its social profiles and its event-contact links,
  but not events. Deleting an event deletes its event-contact links, but not
  contacts.
- The database schema does not enforce the one-link-per-event/contact rule.
  Application-level enforcement is not implemented yet, so duplicate pairs
  can currently be inserted.

## Tables

`key` is the primary key in each table. It is an application-provided integer;
the schema does not declare it as `AUTOINCREMENT`.

### `contact`

Stores a person's contact details.

| Column | SQLite type | Null | Default | Description |
| --- | --- | --- | --- | --- |
| `key` | `INTEGER` | No | — | Primary key |
| `version` | `INTEGER` | No | — | Optimistic-lock version |
| `name` | `TEXT` | No | — | Contact name |
| `street` | `TEXT` | No | — | Street address |
| `postcode` | `NUMERIC` | No | — | Postal code |
| `city` | `TEXT` | No | — | City |
| `phone` | `TEXT` | Yes | `NULL` | Phone number |
| `email` | `TEXT` | Yes | `NULL` | Email address |
| `tag` | `TEXT` | Yes | `NULL` | Optional tag |
| `comment` | `TEXT` | Yes | `NULL` | Optional notes |

All text columns use SQLite's `RTRIM` collation.

### `contact_socials`

Stores a social-media identity belonging to a contact.

| Column | SQLite type | Null | Default | Description |
| --- | --- | --- | --- | --- |
| `key` | `INTEGER` | No | — | Primary key |
| `version` | `INTEGER` | No | — | Optimistic-lock version |
| `contact_key` | `INTEGER` | No | — | Owning contact; foreign key to `contact.key` |
| `media` | `TEXT` | No | — | Social platform |
| `userid` | `TEXT` | Yes | `NULL` | Platform user identifier |
| `comment` | `TEXT` | Yes | `NULL` | Optional notes |

Text columns use `RTRIM` collation. Deleting the referenced contact cascades
deletion of its social rows.

### `event`

Stores an event independently of its participating contacts.

| Column | SQLite type | Null | Default | Description |
| --- | --- | --- | --- | --- |
| `key` | `INTEGER` | No | — | Primary key |
| `version` | `INTEGER` | No | — | Optimistic-lock version |
| `name` | `TEXT` | No | — | Event name |
| `start` | `TEXT` | No | — | Event start value |
| `end` | `TEXT` | No | — | Event end value |
| `comment` | `TEXT` | Yes | `NULL` | Optional notes |

All text columns use `RTRIM` collation. The schema stores `start` and `end` as
text and does not enforce their format. Application operations require
canonical UTC ISO-8601 values (`YYYY-MM-DDTHH:mm:ss.sssZ`) so text ordering is
chronological.

### `event_contacts`

Join table associating contacts with events. A row is a relationship, not an
event or a contact.

| Column | SQLite type | Null | Default | Description |
| --- | --- | --- | --- | --- |
| `key` | `INTEGER` | No | — | Primary key for this relationship row |
| `version` | `INTEGER` | No | `1` | Optimistic-lock version |
| `event_key` | `INTEGER` | No | — | Foreign key to `event.key` |
| `contact_key` | `INTEGER` | No | — | Foreign key to `contact.key` |
| `role` | `TEXT` | Yes | `NULL` | Contact's role at the event |

`role` uses `RTRIM` collation. Deleting either referenced parent cascades
deletion of this relationship row only.

### `note`

Stores a standalone note, optionally assigned to a contact, an event, or both.

| Column | SQLite type | Null | Default | Description |
| --- | --- | --- | --- | --- |
| `key` | `INTEGER` | No | — | Primary key |
| `version` | `INTEGER` | No | `1` | Optimistic-lock version |
| `created_at` | `TEXT` | No | — | Application-generated UTC ISO-8601 timestamp (`YYYY-MM-DDTHH:mm:ss.sssZ`) |
| `heading` | `TEXT` | No | — | Nonblank heading |
| `text` | `TEXT` | No | — | Nonblank note body |
`heading` and `text` use `RTRIM` collation and database checks reject values
containing only common whitespace characters. Notes have no parent columns;
assignments are stored in the join tables below.

### `note_contacts`

Associates notes with contacts. Its composite primary key prevents duplicate
links.

| Column | SQLite type | Null | Default | Description |
| --- | --- | --- | --- | --- |
| `note_key` | `INTEGER` | No | — | Foreign key to `note.key` |
| `contact_key` | `INTEGER` | No | — | Foreign key to `contact.key` |

### `note_events`

Associates notes with events. Its composite primary key prevents duplicate
links.

| Column | SQLite type | Null | Default | Description |
| --- | --- | --- | --- | --- |
| `note_key` | `INTEGER` | No | — | Foreign key to `note.key` |
| `event_key` | `INTEGER` | No | — | Foreign key to `event.key` |

The join tables have no independent version: assignment changes are made
through the note-link operations, which optimistically update the owning
note's version.

## Foreign keys and delete behavior

| Child table and column | References | Delete action |
| --- | --- | --- |
| `contact_socials.contact_key` | `contact.key` | `ON DELETE CASCADE` |
| `event_contacts.event_key` | `event.key` | `ON DELETE CASCADE` |
| `event_contacts.contact_key` | `contact.key` | `ON DELETE CASCADE` |
| `note_contacts.note_key` | `note.key` | `ON DELETE CASCADE` |
| `note_contacts.contact_key` | `contact.key` | `ON DELETE CASCADE` |
| `note_events.note_key` | `note.key` | `ON DELETE CASCADE` |
| `note_events.event_key` | `event.key` | `ON DELETE CASCADE` |

Foreign-key enforcement is enabled by the application's shared connection in
`src/server/db/client.ts`. SQLite foreign keys are connection-specific, so any
other program or connection that writes to this database must also enable
foreign-key enforcement.

There are no foreign keys from `contact` to `event` or from `event` to
`contact`. Parent deletion therefore cannot cascade from one entity to the
other; only matching child/join rows are removed.

## Indexes

| Index | Table | Columns | Purpose |
| --- | --- | --- | --- |
| Primary-key index | `contact` | `key` | Enforces contact identity |
| `ix_contact_city` | `contact` | `city` ascending | Lookup/order contacts by city |
| `ix_contact_name` | `contact` | `name` ascending | Lookup/order contacts by name |
| Primary-key index | `contact_socials` | `key` | Enforces social-row identity |
| `ix_social_contact_key` | `contact_socials` | `contact_key` ascending | Find socials for a contact and support contact cascades |
| `ix_social_media` | `contact_socials` | `media` ascending | Lookup/order social profiles by platform |
| Primary-key index | `event` | `key` | Enforces event identity |
| Primary-key index | `event_contacts` | `key` | Enforces relationship-row identity |
| `ix_event_contacts_event_key` | `event_contacts` | `event_key` ascending | Find contacts for an event and support event cascades |
| `ix_event_contacts_contact_key` | `event_contacts` | `contact_key` ascending | Find events for a contact and support contact cascades |
| Primary-key index | `note` | `key` | Enforces note identity |
| `ix_note_contacts_contact_key` | `note_contacts` | `contact_key` ascending | Find notes assigned to a contact; support contact deletion |
| `ix_note_events_event_key` | `note_events` | `event_key` ascending | Find notes assigned to an event; support event deletion |

SQLite creates the primary-key indexes implicitly. The composite primary keys
on `note_contacts` and `note_events` prevent duplicate note assignments.
`event_contacts` has only its surrogate `key` as a primary key; enforcing one
link per event/contact pair still requires application code.

## Versioning

Every entity and versioned relationship table (`contact`, `contact_socials`,
`event`, `event_contacts`, and `note`) has a non-null integer `version`. The
server update layer compares the caller's expected version and increments the
stored value on a successful update. Deletes also require a matching expected
version. `event_contacts` and `note` default their version to `1`; inserts
through the typed APIs use those database defaults. The note-assignment join
tables (`note_contacts` and `note_events`) have no independent version; link
and unlink operations increment the owning note's version. Deleting a contact
or event also increments the version of each linked note while removing the
join rows in the same application transaction.

## Schema changes

The database file is the current schema source of truth. SQL migrations are
stored in `database/migrations/`; generated TypeScript records are refreshed
with `npm run db:types`. See the [SQLite server data layer documentation](./database-layer.md)
for the migration and type-generation workflow.
