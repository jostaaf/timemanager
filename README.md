# Time manager

The server-side data layer uses SQLite directly through `better-sqlite3`, with
generated TypeScript record types and one CRUD module per table. See the
[SQLite server data layer documentation](docs/database-layer.md) for the
architecture, CRUD behavior, and schema-change workflow.
See the [database model](docs/database-model.md) for tables, relationships,
foreign keys, and indexes.

Application use cases and business rules are kept separately in
`src/server/application/`, above the persistence-focused `src/server/db/`
modules.

## Setup

Install Node.js and npm, then run:

```sh
npm install
npm run db:init
npm run check
npm test
```

`npm run db:init` creates `database/timemanager.db` from the canonical
`database/schema.sql` baseline. It refuses to modify a database with a
mismatching schema.

`npm run check` regenerates database types and type-checks the project.
`npm test` builds the code and runs database-layer tests against a temporary
database created from the project schema; it does not write user rows to the
project database. See the [database-layer documentation](docs/database-layer.md)
for test coverage and all available database commands.

## Local API

The first HTTP/JSON API slice supports contacts and their social records. Start
it after initializing the database:

```sh
npm run api:start
```

The server binds only to `127.0.0.1`, chooses an available port by default, and
prints one JSON startup line containing its address and a random bearer token.
A desktop client should capture this line and send the token in the
`Authorization: Bearer <token>` header. Do not expose the token in logs or to
other local users. Set `TIMEMANAGER_API_PORT` to choose a fixed port.

The endpoints are `GET` and `POST /api/contacts`, plus `GET`, `PATCH`, and
`DELETE /api/contacts/{key}`. Updates and deletes require an `expectedVersion`;
stale versions return `409 Conflict`. Contact list filters and pagination are
available as query parameters (`name`, `address`, `zip`, `city`, `phone`,
`email`, `tag`, `socialMedia`, `socialUserId`, `sortBy`, `sortDirection`,
`limit`, and `offset`).

`POST /api/contacts` accepts `{ "contact": { ... }, "socials": [] }`. The
contact object has `name`, `street`, `zip`, `city`, `phone`, `email`, `tag`, and
`comment`; each optional social has `media`, `userid`, and `comment`. The API
assigns database keys and starts record versions at `1`. `GET
/api/contacts/{key}` returns one contact with its socials.
`PATCH /api/contacts/{key}` accepts `expectedVersion`, a partial `changes`
object, and `socialChanges`. Each social change is an `add` with a `record`
(the API assigns its key and version), an `update` with `key`,
`expectedVersion`, and partial `changes`, or a `delete` with `key` and
`expectedVersion`. Expected versions are non-negative integers because older
database rows may have version `0`; newly created records start at version `1`.
`DELETE` takes an `expectedVersion` JSON body. Validation
failures return `400`; missing records return `404`; stale versions and
uniqueness/relationship conflicts return `409`.

## GNOME client

The initial native Ubuntu client uses GJS, GTK 4, and libadwaita. It starts the
local API as a child process, reads its ephemeral token directly from the
startup pipe, and provides searchable contact details with create, edit,
social-account management, and delete flows. Install the GNOME runtime
bindings if needed:

```sh
sudo apt install gettext gjs gir1.2-gtk-4.0 gir1.2-adw-1 gir1.2-soup-3.0
```

Then launch it from the project checkout:

```sh
npm run client:gnome
```

This command builds the server first. As with the API command, initialize the
database with `npm run db:init` before the first launch. The client is kept
separate from the TypeScript server so the API contract can later serve other
clients without coupling their UI to database or application-layer modules.

The client uses gettext and follows the desktop's system language. English is
the source language and Swedish translations are included. Translation
catalogs live in `po/`. Run `npm run i18n:extract` after changing client
messages, then update each `.po` catalog (currently `po/sv.po`).
`npm run i18n:compile` compiles catalogs to the ignored `locale/` directory,
and the GNOME launch command does this automatically. To use another language,
add its code to `po/LINGUAS` and provide a matching catalog.

For prototype diagnostics, open the application menu and choose **Show Log**.
The timestamped log records client actions and API request results, including
the contact-save flow. It is kept in memory, limited to the most recent 500
entries, and does not record API request bodies or authentication tokens.

To build without running tests:

```sh
npm run build
```

To regenerate database types explicitly:

```sh
npm run db:types
```

See the database-layer documentation for the schema baseline and workflow for
future schema changes.
