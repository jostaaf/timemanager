import { db } from "./client.js";
import {
  deleteRecord,
  updateRecord,
  type OptimisticDeleteResult,
  type OptimisticUpdateResult,
} from "./optimistic-update.js";
import type { NewNoteRecord, NoteRecord, NoteUpdate } from "./types.js";

export type CreateNoteInput = Omit<
  NewNoteRecord,
  "created_at" | "version" | "event_key" | "contact_key"
> & {
  event_key?: number | null;
  contact_key?: number | null;
};

function assertNonBlank(value: string, field: "heading" | "text"): void {
  if (value.trim().length === 0) {
    throw new TypeError(`Note ${field} must not be empty`);
  }
}

export function insertNote(input: CreateNoteInput): NoteRecord {
  assertNonBlank(input.heading, "heading");
  assertNonBlank(input.text, "text");

  const inserted = db
    .prepare<
      Pick<NoteRecord, "key" | "heading" | "text" | "event_key" | "contact_key">,
      NoteRecord
    >(
      `INSERT INTO note ("key", "heading", "text", "event_key", "contact_key")
       VALUES (@key, @heading, @text, @event_key, @contact_key)
       RETURNING *`,
    )
    .get({
      key: input.key,
      heading: input.heading,
      text: input.text,
      event_key: input.event_key ?? null,
      contact_key: input.contact_key ?? null,
    });
  if (!inserted) {
    throw new Error("Inserting note did not return a record");
  }
  return inserted;
}

export function updateNote(
  key: number,
  expectedVersion: number,
  changes: NoteUpdate,
): OptimisticUpdateResult<NoteRecord> {
  if (changes.heading !== undefined) {
    assertNonBlank(changes.heading, "heading");
  }
  if (changes.text !== undefined) {
    assertNonBlank(changes.text, "text");
  }

  return updateRecord<NoteRecord>("note", key, expectedVersion, changes);
}

export function deleteNote(
  key: number,
  expectedVersion: number,
): OptimisticDeleteResult<NoteRecord> {
  return deleteRecord<NoteRecord>("note", key, expectedVersion);
}
