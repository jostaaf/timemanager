import { db } from "./client.js";
import {
  deleteRecord,
  type OptimisticDeleteResult,
} from "./optimistic-update.js";

type ParentTable = "contact" | "event";
type ParentLinkTable = "note_contacts" | "note_events";
type ParentLinkColumn = "contact_key" | "event_key";

export function deleteParentAndPreserveNotes<Record extends { key: number; version: number }>(
  table: ParentTable,
  linkTable: ParentLinkTable,
  parentColumn: ParentLinkColumn,
  key: number,
  expectedVersion: number,
): OptimisticDeleteResult<Record> {
  return db.transaction(() => {
    const linkedNotes = db
      .prepare<[number], { key: number }>(
        `SELECT "note_key" AS "key"
         FROM "${linkTable}"
         WHERE "${parentColumn}" = ?`,
      )
      .all(key);
    const result = deleteRecord<Record>(table, key, expectedVersion);
    if (result.status === "deleted" && linkedNotes.length > 0) {
      const incrementNoteVersion = db.prepare<[number]>(
        'UPDATE note SET "version" = "version" + 1 WHERE "key" = ?',
      );
      for (const note of linkedNotes) {
        incrementNoteVersion.run(note.key);
      }
    }
    return result;
  })();
}
