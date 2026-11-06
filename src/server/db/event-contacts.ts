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
    .get({ ...record, version: record.version ?? 1 });
  if (!inserted) {
    throw new Error("Inserting event contact did not return a record");
  }
  return inserted;
}

export function getEventContactByPair(
  eventKey: number,
  contactKey: number,
): EventContactsRecord | undefined {
  return db
    .prepare<[number, number], EventContactsRecord>(
      `SELECT *
       FROM event_contacts
       WHERE "event_key" = ? AND "contact_key" = ?
       ORDER BY "key"
       LIMIT 1`,
    )
    .get(eventKey, contactKey);
}

export function getEventContactByKey(
  key: number,
): EventContactsRecord | undefined {
  return db
    .prepare<[number], EventContactsRecord>(
      'SELECT * FROM event_contacts WHERE "key" = ?',
    )
    .get(key);
}

export function getEventContactsForEvent(
  eventKey: number,
): EventContactsRecord[] {
  return db
    .prepare<[number], EventContactsRecord>(
      `SELECT *
       FROM event_contacts
       WHERE "event_key" = ?
       ORDER BY "key"`,
    )
    .all(eventKey);
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
