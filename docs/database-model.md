# Database model

This document describes the SQLite schema in `database/timemanager.db`.
It reflects the schema after migrations 001 and 002.

## Entity relationship summary

```text
contact  1 ───── 0..* contact_socials

contact  1 ───── 0..* event_contacts 0..* ───── 1 event
                       (join table)
```

- A contact may exist without social profiles, and a social profile must belong
  to exactly one existing contact.
- An event and a contact are independent entities. Either may exist without
  any event/contact relationship.
- `event_contacts` implements the many-to-many relationship: each row connects
  one event to one contact, and each event/contact can be linked to many rows.
- Deleting a contact deletes its social profiles and its event-contact links,
  but not events. Deleting an event deletes its event-contact links, but not
  contacts.
- The schema does not currently enforce uniqueness of a contact/event pair;
  the same contact can be linked to the same event more than once.

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
text; it does not enforce a particular date/time format.

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

## Foreign keys and delete behavior

| Child table and column | References | Delete action |
| --- | --- | --- |
| `contact_socials.contact_key` | `contact.key` | `ON DELETE CASCADE` |
| `event_contacts.event_key` | `event.key` | `ON DELETE CASCADE` |
| `event_contacts.contact_key` | `contact.key` | `ON DELETE CASCADE` |

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

SQLite creates the primary-key indexes implicitly. There is no unique index on
`(event_key, contact_key)`, so duplicate links are currently allowed.

## Versioning

Every table has a non-null integer `version`. The server update layer compares
the caller's expected version and increments the stored value on a successful
update. Deletes also require a matching expected version. `event_contacts`
defaults its version to `1`; inserts through the typed API still supply the
initial version explicitly.

## Schema changes

The database file is the current schema source of truth. SQL migrations are
stored in `database/migrations/`; generated TypeScript records are refreshed
with `npm run db:types`. See the [SQLite server data layer documentation](./database-layer.md)
for the migration and type-generation workflow.
