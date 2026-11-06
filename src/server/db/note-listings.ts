import { db } from "./client.js";
import type { NoteRecord } from "./types.js";

function containsPattern(value: string): string {
  return `%${value.replace(/[!%_]/g, "!$&")}%`;
}

export function listNotes(): NoteRecord[] {
  return db
    .prepare<[], NoteRecord>(
      `SELECT *
       FROM note
       ORDER BY "created_at" DESC, "key" DESC`,
    )
    .all();
}

export function searchNotes(query: string): NoteRecord[] {
  const pattern = containsPattern(query);
  return db
    .prepare<[string, string], NoteRecord>(
      `SELECT *
       FROM note
       WHERE "heading" LIKE ? ESCAPE '!' COLLATE NOCASE
          OR "text" LIKE ? ESCAPE '!' COLLATE NOCASE
       ORDER BY "created_at" DESC, "key" DESC`,
    )
    .all(pattern, pattern);
}

export function listNotesCreatedInRange(
  fromInclusive: string,
  toExclusive: string,
): NoteRecord[] {
  return db
    .prepare<[string, string], NoteRecord>(
      `SELECT *
       FROM note
       WHERE "created_at" >= ? AND "created_at" < ?
       ORDER BY "created_at" DESC, "key" DESC`,
    )
    .all(fromInclusive, toExclusive);
}

export function listStandaloneNotes(): NoteRecord[] {
  return db
    .prepare<[], NoteRecord>(
      `SELECT note.*
       FROM note
       WHERE NOT EXISTS (
         SELECT 1
         FROM note_contacts
         WHERE note_contacts."note_key" = note."key"
       )
         AND NOT EXISTS (
           SELECT 1
           FROM note_events
           WHERE note_events."note_key" = note."key"
         )
       ORDER BY note."created_at" DESC, note."key" DESC`,
    )
    .all();
}

export function listNotesForContactAndEvent(
  contactKey: number,
  eventKey: number,
): NoteRecord[] {
  return db
    .prepare<[number, number], NoteRecord>(
      `SELECT note.*
       FROM note
       WHERE EXISTS (
         SELECT 1
         FROM note_contacts
         WHERE note_contacts."note_key" = note."key"
           AND note_contacts."contact_key" = ?
       )
         AND EXISTS (
           SELECT 1
           FROM note_events
           WHERE note_events."note_key" = note."key"
             AND note_events."event_key" = ?
         )
       ORDER BY note."created_at" DESC, note."key" DESC`,
    )
    .all(contactKey, eventKey);
}
