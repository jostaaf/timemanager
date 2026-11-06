import { db } from "./client.js";

type VersionedRecord = {
  key: number;
  version: number;
};

export type OptimisticUpdateResult<Record> =
  | { status: "updated"; record: Record }
  | { status: "conflict"; currentVersion: number }
  | { status: "not_found" };

export type OptimisticDeleteResult<Record> =
  | { status: "deleted"; record: Record }
  | { status: "conflict"; currentVersion: number }
  | { status: "not_found" };

type VersionedTable =
  | "contact"
  | "contact_socials"
  | "event"
  | "event_contacts"
  | "note";

function getCurrentVersion(
  table: VersionedTable,
  key: number,
): { version: number } | undefined {
  const escapedTable = table.replaceAll('"', '""');
  return db
    .prepare<[number], { version: number }>(
      `SELECT "version" FROM "${escapedTable}" WHERE "key" = ?`,
    )
    .get(key);
}

export function updateRecord<Record extends VersionedRecord>(
  table: VersionedTable,
  key: number,
  expectedVersion: number,
  changes: Partial<Omit<Record, "key" | "version">>,
): OptimisticUpdateResult<Record> {
  const entries = Object.entries(changes);
  if (entries.some(([column]) => column === "key" || column === "version")) {
    throw new TypeError("Record key and version cannot be updated as fields");
  }

  const escapedTable = table.replaceAll('"', '""');
  const transaction = db.transaction((): OptimisticUpdateResult<Record> => {
    if (entries.length > 0) {
      const assignments = entries
        .map(([column]) => `"${column.replaceAll('"', '""')}" = ?`)
        .join(", ");
      const values = entries.map(([, value]) => value);
      const updated = db
        .prepare<unknown[], Record>(
          `UPDATE "${escapedTable}"
           SET ${assignments}, "version" = "version" + 1
           WHERE "key" = ? AND "version" = ?
           RETURNING *`,
        )
        .get(...values, key, expectedVersion);
      if (updated) {
        return { status: "updated", record: updated };
      }
    } else {
      const unchanged = db
        .prepare<[number, number], Record>(
          `SELECT * FROM "${escapedTable}"
           WHERE "key" = ? AND "version" = ?`,
        )
        .get(key, expectedVersion);
      if (unchanged) {
        return { status: "updated", record: unchanged };
      }
    }

    const current = getCurrentVersion(table, key);
    if (!current) {
      return { status: "not_found" };
    }
    return { status: "conflict", currentVersion: current.version };
  });

  return transaction();
}

export function deleteRecord<Record extends VersionedRecord>(
  table: VersionedTable,
  key: number,
  expectedVersion: number,
): OptimisticDeleteResult<Record> {
  const escapedTable = table.replaceAll('"', '""');
  const transaction = db.transaction((): OptimisticDeleteResult<Record> => {
    const deleted = db
      .prepare<[number, number], Record>(
        `DELETE FROM "${escapedTable}"
         WHERE "key" = ? AND "version" = ?
         RETURNING *`,
      )
      .get(key, expectedVersion);
    if (deleted) {
      return { status: "deleted", record: deleted };
    }

    const current = getCurrentVersion(table, key);
    if (!current) {
      return { status: "not_found" };
    }
    return { status: "conflict", currentVersion: current.version };
  });

  return transaction();
}
