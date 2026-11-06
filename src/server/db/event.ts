import type {
  EventRecord,
  EventUpdate,
  NewEventRecord,
} from "./types.js";
import { db } from "./client.js";
import {
  updateRecord,
  type OptimisticUpdateResult,
} from "./optimistic-update.js";
import { deleteParentAndPreserveNotes } from "./delete-parent.js";
import type { OptimisticDeleteResult } from "./optimistic-update.js";

export function insertEvent(
  record: NewEventRecord,
): EventRecord {
  const inserted = db
    .prepare<NewEventRecord, EventRecord>(
      `INSERT INTO event ("key", "version", "name", "start", "end", "comment")
       VALUES (@key, @version, @name, @start, @end, @comment)
       RETURNING *`,
    )
    .get(record);
  if (!inserted) {
    throw new Error("Inserting event did not return a record");
  }
  return inserted;
}

export function getEventByKey(key: number): EventRecord | undefined {
  return db
    .prepare<[number], EventRecord>('SELECT * FROM event WHERE "key" = ?')
    .get(key);
}

export function updateEvent(
  key: number,
  expectedVersion: number,
  changes: EventUpdate,
): OptimisticUpdateResult<EventRecord> {
  return updateRecord<EventRecord>("event", key, expectedVersion, changes);
}

export function deleteEvent(
  key: number,
  expectedVersion: number,
): OptimisticDeleteResult<EventRecord> {
  return deleteParentAndPreserveNotes<EventRecord>(
    "event",
    "note_events",
    "event_key",
    key,
    expectedVersion,
  );
}
