import type {
  EventContactsRecord,
  EventContactsUpdate,
  NewEventContactsRecord,
} from "./types.js";
import { db } from "./client.js";
import {
  deleteRecord,
  updateRecord,
  type OptimisticDeleteResult,
  type OptimisticUpdateResult,
} from "./optimistic-update.js";

export function insertEventContact(
  record: NewEventContactsRecord,
): EventContactsRecord {
  const inserted = db
    .prepare<NewEventContactsRecord, EventContactsRecord>(
      `INSERT INTO event_contacts
        ("key", "version", "event_key", "contact_key", "role")
       VALUES
        (@key, @version, @event_key, @contact_key, @role)
       RETURNING *`,
    )
    .get(record);
  if (!inserted) {
    throw new Error("Inserting event contact did not return a record");
  }
  return inserted;
}

export function updateEventContact(
  key: number,
  expectedVersion: number,
  changes: EventContactsUpdate,
): OptimisticUpdateResult<EventContactsRecord> {
  return updateRecord<EventContactsRecord>(
    "event_contacts",
    key,
    expectedVersion,
    changes,
  );
}

export function deleteEventContact(
  key: number,
  expectedVersion: number,
): OptimisticDeleteResult<EventContactsRecord> {
  return deleteRecord<EventContactsRecord>(
    "event_contacts",
    key,
    expectedVersion,
  );
}
