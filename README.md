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
npm run check
npm test
```

`npm run check` regenerates database types and type-checks the project.
`npm test` builds the code and runs database-layer tests against a temporary
database created from the project schema; it does not write user rows to the
project database. See the [database-layer documentation](docs/database-layer.md)
for test coverage and all available database commands.

To build without running tests:

```sh
npm run build
```

To regenerate database types explicitly:

```sh
npm run db:types
```

After backing up the database, add the notes table with:

```sh
npm run db:migrate:notes
npm run db:types
```

To migrate note assignments to many-to-many links:

```sh
npm run db:migrate:note-links
npm run db:types
```

See the database-layer documentation for setup details and the recommended
workflow when changing the SQLite schema.
