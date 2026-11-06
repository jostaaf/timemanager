import {
  listNotes,
  listNotesCreatedInRange as queryNotesCreatedInRange,
  listNotesForContactAndEvent as queryNotesForContactAndEvent,
  listStandaloneNotes,
  searchNotes as queryNotes,
} from "../../db/note-listings.js";
import {
  listNotesForContact,
  listNotesForEvent,
} from "../../db/note-links.js";
import type { NoteRecord } from "../../db/types.js";
import { assertUtcIsoTimestamp } from "../timestamps.js";

export function listAllNotes(): NoteRecord[] {
  return listNotes();
}

export function searchNotes(query: string): NoteRecord[] {
  const search = query.trim();
  return search.length === 0 ? [] : queryNotes(search);
}

export function listNotesCreatedInRange(
  fromInclusive: string,
  toExclusive: string,
): NoteRecord[] {
  assertUtcIsoTimestamp(fromInclusive, "Note range start");
  assertUtcIsoTimestamp(toExclusive, "Note range end");
  if (fromInclusive >= toExclusive) {
    throw new RangeError("Note range end must be later than its start");
  }
  return queryNotesCreatedInRange(fromInclusive, toExclusive);
}

export function listUnassignedNotes(): NoteRecord[] {
  return listStandaloneNotes();
}

export function listNotesForContactKey(contactKey: number): NoteRecord[] {
  return listNotesForContact(contactKey);
}

export function listNotesForEventKey(eventKey: number): NoteRecord[] {
  return listNotesForEvent(eventKey);
}

export function listNotesForContactAndEvent(
  contactKey: number,
  eventKey: number,
): NoteRecord[] {
  return queryNotesForContactAndEvent(contactKey, eventKey);
}
