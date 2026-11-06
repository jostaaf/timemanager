import { db } from "./client.js";
import type { NoteRecord } from "./types.js";

export type NoteLinkResult =
  | { status: "updated"; record: NoteRecord }
  | { status: "unchanged"; record: NoteRecord }
  | { status: "conflict"; currentVersion: number }
  | { status: "not_found" };

type LinkTable = "note_contacts" | "note_events";
type ParentColumn = "contact_key" | "event_key";

function changeNoteLink(
  table: LinkTable,
  parentColumn: ParentColumn,
  noteKey: number,
  expectedVersion: number,
  parentKey: number,
  link: boolean,
): NoteLinkResult {
  const transaction = db.transaction((): NoteLinkResult => {
    const note = db
      .prepare<[number], NoteRecord>('SELECT * FROM note WHERE "key" = ?')
      .get(noteKey);
    if (!note) {
      return { status: "not_found" };
    }
    if (note.version !== expectedVersion) {
      return { status: "conflict", currentVersion: note.version };
    }

    const result = link
      ? db
          .prepare<[number, number]>(
            `INSERT INTO "${table}" ("note_key", "${parentColumn}")
             VALUES (?, ?)
             ON CONFLICT DO NOTHING`,
          )
          .run(noteKey, parentKey)
      : db
          .prepare<[number, number]>(
            `DELETE FROM "${table}"
             WHERE "note_key" = ? AND "${parentColumn}" = ?`,
          )
          .run(noteKey, parentKey);

    if (result.changes === 0) {
      return { status: "unchanged", record: note };
    }

    const updated = db
      .prepare<[number, number], NoteRecord>(
        `UPDATE note
         SET "version" = "version" + 1
         WHERE "key" = ? AND "version" = ?
         RETURNING *`,
      )
      .get(noteKey, expectedVersion);
    if (!updated) {
      throw new Error("Updating note version after changing its links failed");
    }
    return { status: "updated", record: updated };
  });

  return transaction();
}

export function linkNoteToContact(
  noteKey: number,
  expectedVersion: number,
  contactKey: number,
): NoteLinkResult {
  return changeNoteLink(
    "note_contacts",
    "contact_key",
    noteKey,
    expectedVersion,
    contactKey,
    true,
  );
}

export function unlinkNoteFromContact(
  noteKey: number,
  expectedVersion: number,
  contactKey: number,
): NoteLinkResult {
  return changeNoteLink(
    "note_contacts",
    "contact_key",
    noteKey,
    expectedVersion,
    contactKey,
    false,
  );
}

export function linkNoteToEvent(
  noteKey: number,
  expectedVersion: number,
  eventKey: number,
): NoteLinkResult {
  return changeNoteLink(
    "note_events",
    "event_key",
    noteKey,
    expectedVersion,
    eventKey,
    true,
  );
}

export function unlinkNoteFromEvent(
  noteKey: number,
  expectedVersion: number,
  eventKey: number,
): NoteLinkResult {
  return changeNoteLink(
    "note_events",
    "event_key",
    noteKey,
    expectedVersion,
    eventKey,
    false,
  );
}

export function listContactsForNote(noteKey: number): number[] {
  return db
    .prepare<[number], { contact_key: number }>(
      `SELECT "contact_key"
       FROM note_contacts
       WHERE "note_key" = ?
       ORDER BY "contact_key"`,
    )
    .all(noteKey)
    .map((row) => row.contact_key);
}

export function listEventsForNote(noteKey: number): number[] {
  return db
    .prepare<[number], { event_key: number }>(
      `SELECT "event_key"
       FROM note_events
       WHERE "note_key" = ?
       ORDER BY "event_key"`,
    )
    .all(noteKey)
    .map((row) => row.event_key);
}

export function listNotesForContact(contactKey: number): NoteRecord[] {
  return db
    .prepare<[number], NoteRecord>(
      `SELECT note.*
       FROM note
       JOIN note_contacts ON note_contacts."note_key" = note."key"
       WHERE note_contacts."contact_key" = ?
       ORDER BY note."created_at" DESC, note."key" DESC`,
    )
    .all(contactKey);
}

export function listNotesForEvent(eventKey: number): NoteRecord[] {
  return db
    .prepare<[number], NoteRecord>(
      `SELECT note.*
       FROM note
       JOIN note_events ON note_events."note_key" = note."key"
       WHERE note_events."event_key" = ?
       ORDER BY note."created_at" DESC, note."key" DESC`,
    )
    .all(eventKey);
}
