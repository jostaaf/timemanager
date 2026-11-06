import { db } from "./client.js";
import {
  deleteRecord,
  type OptimisticDeleteResult,
} from "./optimistic-update.js";

type ParentTable = "contact" | "event";
type ParentNoteColumn = "contact_key" | "event_key";

export function deleteParentAndPreserveNotes<Record extends { key: number; version: number }>(
  table: ParentTable,
  noteColumn: ParentNoteColumn,
  key: number,
  expectedVersion: number,
): OptimisticDeleteResult<Record> {
  return db.transaction(() => {
    const linkedNotes = db
      .prepare<[number], { key: number }>(
        `SELECT "key" FROM note WHERE "${noteColumn}" = ?`,
      )
      .all(key);
    const result = deleteRecord<Record>(table, key, expectedVersion);
    if (result.status === "deleted" && linkedNotes.length > 0) {
      const placeholders = linkedNotes.map(() => "?").join(", ");
      const noteKeys = linkedNotes.map((note) => note.key);
      db.prepare<unknown[]>(
        `UPDATE note
         SET "version" = "version" + 1
         WHERE "key" IN (${placeholders})`,
      ).run(...noteKeys);
    }
    return result;
  })();
}
