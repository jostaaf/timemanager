import { getContactByKey } from "../../db/contact.js";
import { runInImmediateTransaction } from "../../db/client.js";
import { getEventByKey } from "../../db/event.js";
import {
  linkNoteToContact,
  linkNoteToEvent,
} from "../../db/note-links.js";
import { insertNote, type CreateNoteInput } from "../../db/note.js";
import type { NoteRecord } from "../../db/types.js";

export interface CreateNoteWithAssignmentsInput extends CreateNoteInput {
  contactKeys?: readonly number[];
  eventKeys?: readonly number[];
}

export type CreateNoteResult =
  | {
      status: "created";
      note: NoteRecord;
      contactKeys: number[];
      eventKeys: number[];
    }
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

export function createNote(
  input: CreateNoteWithAssignmentsInput,
): CreateNoteResult {
  return runInImmediateTransaction(() => {
    const contactKeys = input.contactKeys ?? [];
    const eventKeys = input.eventKeys ?? [];

    const duplicateContact = findDuplicate(contactKeys);
    if (duplicateContact !== undefined) {
      return { status: "duplicate_contact", contactKey: duplicateContact };
    }
    const duplicateEvent = findDuplicate(eventKeys);
    if (duplicateEvent !== undefined) {
      return { status: "duplicate_event", eventKey: duplicateEvent };
    }

    for (const contactKey of contactKeys) {
      if (!getContactByKey(contactKey)) {
        return { status: "contact_not_found", contactKey };
      }
    }
    for (const eventKey of eventKeys) {
      if (!getEventByKey(eventKey)) {
        return { status: "event_not_found", eventKey };
      }
    }

    let note = insertNote(input);
    for (const contactKey of contactKeys) {
      const result = linkNoteToContact(note.key, note.version, contactKey);
      if (result.status !== "updated") {
        throw new Error("Could not assign contact while creating note");
      }
      note = result.record;
    }
    for (const eventKey of eventKeys) {
      const result = linkNoteToEvent(note.key, note.version, eventKey);
      if (result.status !== "updated") {
        throw new Error("Could not assign event while creating note");
      }
      note = result.record;
    }

    return { status: "created", note, contactKeys: [...contactKeys], eventKeys: [...eventKeys] };
  });
}
