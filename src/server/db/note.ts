import { db } from "./client.js";
import {
  deleteRecord,
  updateRecord,
  type OptimisticDeleteResult,
  type OptimisticUpdateResult,
} from "./optimistic-update.js";
import type { NoteRecord, NoteUpdate } from "./types.js";

export type CreateNoteInput = Pick<
  NoteRecord,
  "key" | "created_at" | "heading" | "text"
>;

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
      Pick<NoteRecord, "key" | "created_at" | "heading" | "text">,
      NoteRecord
    >(
      `INSERT INTO note ("key", "created_at", "heading", "text")
       VALUES (@key, @created_at, @heading, @text)
       RETURNING *`,
    )
    .get({
      key: input.key,
      created_at: input.created_at,
      heading: input.heading,
      text: input.text,
    });
  if (!inserted) {
    throw new Error("Inserting note did not return a record");
  }
  return inserted;
}

export function getNoteByKey(key: number): NoteRecord | undefined {
  return db
    .prepare<[number], NoteRecord>('SELECT * FROM note WHERE "key" = ?')
    .get(key);
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
