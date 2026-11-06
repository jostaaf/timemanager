import { getContactByKey } from "../../db/contact.js";
import { runInImmediateTransaction } from "../../db/client.js";
import { getEventByKey } from "../../db/event.js";
import { getNoteByKey, updateNote } from "../../db/note.js";
import {
  listContactsForNote,
  listEventsForNote,
  linkNoteToContact,
  linkNoteToEvent,
  unlinkNoteFromContact,
  unlinkNoteFromEvent,
} from "../../db/note-links.js";
import type { NoteRecord, NoteUpdate } from "../../db/types.js";

export interface UpdateNoteInput {
  noteKey: number;
  expectedVersion: number;
  changes: NoteUpdate;
  contactKeys?: readonly number[];
  eventKeys?: readonly number[];
}

export type UpdateNoteResult =
  | {
      status: "updated";
      note: NoteRecord;
      contactKeys: number[];
      eventKeys: number[];
    }
  | { status: "note_not_found" }
  | { status: "note_conflict"; currentVersion: number }
  | { status: "duplicate_contact"; contactKey: number }
  | { status: "duplicate_event"; eventKey: number }
  | { status: "contact_not_found"; contactKey: number }
  | { status: "event_not_found"; eventKey: number };

function findDuplicate(values: readonly number[]): number | undefined {
  const seen = new Set<number>();
  for (const value of values) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
  }
  return undefined;
}

export function updateNoteWithAssignments(
  input: UpdateNoteInput,
): UpdateNoteResult {
  return runInImmediateTransaction(() => {
    const note = getNoteByKey(input.noteKey);
    if (!note) {
      return { status: "note_not_found" };
    }
    if (note.version !== input.expectedVersion) {
      return { status: "note_conflict", currentVersion: note.version };
    }

    const desiredContacts = input.contactKeys;
    const desiredEvents = input.eventKeys;

    if (desiredContacts) {
      const duplicateContact = findDuplicate(desiredContacts);
      if (duplicateContact !== undefined) {
        return { status: "duplicate_contact", contactKey: duplicateContact };
      }
      for (const contactKey of desiredContacts) {
        if (!getContactByKey(contactKey)) {
          return { status: "contact_not_found", contactKey };
        }
      }
    }
    if (desiredEvents) {
      const duplicateEvent = findDuplicate(desiredEvents);
      if (duplicateEvent !== undefined) {
        return { status: "duplicate_event", eventKey: duplicateEvent };
      }
      for (const eventKey of desiredEvents) {
        if (!getEventByKey(eventKey)) {
          return { status: "event_not_found", eventKey };
        }
      }
    }

    const updatedNote = updateNote(
      input.noteKey,
      input.expectedVersion,
      input.changes,
    );
    if (updatedNote.status !== "updated") {
      throw new Error("Note changed during an immediate transaction");
    }

    let currentNote = updatedNote.record;
    if (desiredContacts) {
      const currentContacts = listContactsForNote(input.noteKey);
      const desiredSet = new Set(desiredContacts);
      const currentSet = new Set(currentContacts);
      for (const contactKey of currentContacts) {
        if (desiredSet.has(contactKey)) continue;
        const result = unlinkNoteFromContact(
          input.noteKey,
          currentNote.version,
          contactKey,
        );
        if (result.status !== "updated") {
          throw new Error("Could not remove note contact assignment");
        }
        currentNote = result.record;
      }
      for (const contactKey of desiredContacts) {
        if (currentSet.has(contactKey)) continue;
        const result = linkNoteToContact(
          input.noteKey,
          currentNote.version,
          contactKey,
        );
        if (result.status !== "updated") {
          throw new Error("Could not add note contact assignment");
        }
        currentNote = result.record;
      }
    }

    if (desiredEvents) {
      const currentEvents = listEventsForNote(input.noteKey);
      const desiredSet = new Set(desiredEvents);
      const currentSet = new Set(currentEvents);
      for (const eventKey of currentEvents) {
        if (desiredSet.has(eventKey)) continue;
        const result = unlinkNoteFromEvent(
          input.noteKey,
          currentNote.version,
          eventKey,
        );
        if (result.status !== "updated") {
          throw new Error("Could not remove note event assignment");
        }
        currentNote = result.record;
      }
      for (const eventKey of desiredEvents) {
        if (currentSet.has(eventKey)) continue;
        const result = linkNoteToEvent(
          input.noteKey,
          currentNote.version,
          eventKey,
        );
        if (result.status !== "updated") {
          throw new Error("Could not add note event assignment");
        }
        currentNote = result.record;
      }
    }

    return {
      status: "updated",
      note: currentNote,
      contactKeys: listContactsForNote(input.noteKey),
      eventKeys: listEventsForNote(input.noteKey),
    };
  });
}
