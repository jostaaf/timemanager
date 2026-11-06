# Time manager

The server-side data layer uses SQLite directly through `better-sqlite3`, with
generated TypeScript record types and one CRUD module per table. See the
[SQLite server data layer documentation](docs/database-layer.md) for the
architecture, CRUD behavior, and schema-change workflow.

## Setup

Install Node.js and npm, then run:

```sh
npm install
npm run check
```

The check and build scripts regenerate database types before compiling. To
regenerate types explicitly, run:

```sh
npm run db:types
```

See the database-layer documentation for setup details and the recommended
workflow when changing the SQLite schema.
