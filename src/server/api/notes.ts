import { createNoteWithGeneratedKey } from "../application/notes/create-note.js";
import { deleteNoteWithAssignments } from "../application/notes/delete-note.js";
import {
  listAllNotes,
  listNotesForEventKey,
  searchNotes,
} from "../application/notes/list-notes.js";
import { updateNoteWithAssignments } from "../application/notes/update-note.js";
import { getContactByKey } from "../db/contact.js";
import { getEventByKey } from "../db/event.js";
import { listContactsForNote, listEventsForNote } from "../db/note-links.js";
import { getNoteByKey } from "../db/note.js";
import type { NoteRecord } from "../db/types.js";
import type { ApiResponse } from "./contacts.js";

type NoteFields = Pick<NoteRecord, "heading" | "text">;
type NoteChanges = Partial<NoteFields>;

class InvalidRequestError extends Error {}

function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): ApiResponse {
  const error: { code: string; message: string; details?: unknown } = {
    code,
    message,
  };
  if (details !== undefined) error.details = details;
  return { status, body: { error } };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new InvalidRequestError(`Unexpected field: ${key}`);
    }
  }
  for (const key of required) {
    if (!(key in value)) throw new InvalidRequestError(`Missing field: ${key}`);
  }
}

function bodyObject(body: unknown): Record<string, unknown> {
  if (!isObject(body)) {
    throw new InvalidRequestError("Request body must be a JSON object");
  }
  return body;
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new InvalidRequestError(`${field} must be a positive safe integer`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new InvalidRequestError(
      `${field} must be a non-negative safe integer`,
    );
  }
  return value;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidRequestError(`${field} must be a non-empty string`);
  }
  return value;
}

function parseNote(value: unknown): NoteFields {
  if (!isObject(value)) {
    throw new InvalidRequestError("note must be an object");
  }
  assertKeys(value, ["heading", "text"]);
  return {
    heading: nonEmptyString(value.heading, "note.heading"),
    text: nonEmptyString(value.text, "note.text"),
  };
}

function parseChanges(value: unknown): NoteChanges {
  if (!isObject(value)) {
    throw new InvalidRequestError("changes must be an object");
  }
  assertKeys(value, [], ["heading", "text"]);
  const changes: NoteChanges = {};
  if ("heading" in value) {
    changes.heading = nonEmptyString(value.heading, "changes.heading");
  }
  if ("text" in value) {
    changes.text = nonEmptyString(value.text, "changes.text");
  }
  return changes;
}

function parseKeys(value: unknown, field: string): number[] {
  if (!Array.isArray(value)) {
    throw new InvalidRequestError(`${field} must be an array`);
  }
  return value.map((key, index) => positiveInteger(key, `${field}[${index}]`));
}

function noteDetail(note: NoteRecord) {
  const contacts = listContactsForNote(note.key).map((key) => {
    const contact = getContactByKey(key);
    if (!contact) {
      throw new Error(`Note ${note.key} references missing contact ${key}`);
    }
    return contact;
  });
  const events = listEventsForNote(note.key).map((key) => {
    const event = getEventByKey(key);
    if (!event) {
      throw new Error(`Note ${note.key} references missing event ${key}`);
    }
    return event;
  });
  return { note, contacts, events };
}

function isConstraintError(error: unknown): boolean {
  return isObject(error) &&
    typeof error.code === "string" &&
    error.code.startsWith("SQLITE_CONSTRAINT_");
}

function assignmentError(
  status: "duplicate_contact" | "duplicate_event" |
    "contact_not_found" | "event_not_found",
  result: { contactKey?: number; eventKey?: number },
): ApiResponse {
  if (status === "contact_not_found") {
    return errorResponse(404, status, "Contact not found", result);
  }
  if (status === "event_not_found") {
    return errorResponse(404, status, "Event not found", result);
  }
  if (status === "duplicate_contact") {
    return errorResponse(
      409,
      "duplicate_note_contact",
      "A contact can only be assigned to a note once",
      result,
    );
  }
  return errorResponse(
    409,
    "duplicate_note_event",
    "An event can only be assigned to a note once",
    result,
  );
}

export function handleNotesApiRequest(
  method: string,
  url: URL,
  body?: unknown,
): ApiResponse {
  try {
    if (url.pathname === "/api/notes") {
      if (method === "GET") {
        const query = url.searchParams.get("q");
        const eventKeyParameter = url.searchParams.get("eventKey");
        if (eventKeyParameter !== null) {
          if (!/^[1-9]\d*$/.test(eventKeyParameter)) {
            throw new InvalidRequestError(
              "eventKey must be a positive safe integer",
            );
          }
          const eventKey = Number(eventKeyParameter);
          if (!Number.isSafeInteger(eventKey)) {
            throw new InvalidRequestError(
              "eventKey must be a positive safe integer",
            );
          }
          if (!getEventByKey(eventKey)) {
            return errorResponse(404, "event_not_found", "Event not found");
          }
          let notes = listNotesForEventKey(eventKey);
          if (query?.trim()) {
            const matchingNoteKeys = new Set(
              searchNotes(query).map((note) => note.key),
            );
            notes = notes.filter((note) => matchingNoteKeys.has(note.key));
          }
          return { status: 200, body: { notes } };
        }
        return {
          status: 200,
          body: {
            notes: query?.trim() ? searchNotes(query) : listAllNotes(),
          },
        };
      }
      if (method === "POST") {
        const request = bodyObject(body);
        assertKeys(request, ["heading", "text"], ["contactKeys", "eventKeys"]);
        const note = parseNote({
          heading: request.heading,
          text: request.text,
        });
        const result = createNoteWithGeneratedKey({
          ...note,
          contactKeys: "contactKeys" in request
            ? parseKeys(request.contactKeys, "contactKeys")
            : [],
          eventKeys: "eventKeys" in request
            ? parseKeys(request.eventKeys, "eventKeys")
            : [],
        });
        if (result.status !== "created") {
          return assignmentError(result.status, result);
        }
        const created = getNoteByKey(result.note.key);
        if (!created) throw new Error("Created note could not be reloaded");
        return { status: 201, body: noteDetail(created) };
      }
      return errorResponse(405, "method_not_allowed", "Method not allowed");
    }

    const match = /^\/api\/notes\/([1-9]\d*)$/.exec(url.pathname);
    if (!match) return errorResponse(404, "not_found", "API route not found");
    const key = Number(match[1]);
    if (!Number.isSafeInteger(key)) {
      throw new InvalidRequestError("Note key must be a safe integer");
    }

    if (method === "GET") {
      const note = getNoteByKey(key);
      return note
        ? { status: 200, body: noteDetail(note) }
        : errorResponse(404, "note_not_found", "Note not found");
    }
    if (method === "PATCH") {
      const request = bodyObject(body);
      assertKeys(
        request,
        ["expectedVersion", "changes"],
        ["contactKeys", "eventKeys"],
      );
      const result = updateNoteWithAssignments({
        noteKey: key,
        expectedVersion: nonNegativeInteger(
          request.expectedVersion,
          "expectedVersion",
        ),
        changes: parseChanges(request.changes),
        ...("contactKeys" in request
          ? { contactKeys: parseKeys(request.contactKeys, "contactKeys") }
          : {}),
        ...("eventKeys" in request
          ? { eventKeys: parseKeys(request.eventKeys, "eventKeys") }
          : {}),
      });
      if (result.status === "updated") {
        const updated = getNoteByKey(key);
        if (!updated) throw new Error("Updated note could not be reloaded");
        return { status: 200, body: noteDetail(updated) };
      }
      if (result.status === "note_not_found") {
        return errorResponse(404, result.status, "Note not found");
      }
      if (result.status === "note_conflict") {
        return errorResponse(409, result.status, "Note version conflict", result);
      }
      return assignmentError(result.status, result);
    }
    if (method === "DELETE") {
      const request = bodyObject(body);
      assertKeys(request, ["expectedVersion"]);
      const result = deleteNoteWithAssignments(
        key,
        nonNegativeInteger(request.expectedVersion, "expectedVersion"),
      );
      if (result.status === "deleted") {
        return {
          status: 200,
          body: { status: result.status, note: result.record },
        };
      }
      if (result.status === "not_found") {
        return errorResponse(404, "note_not_found", "Note not found");
      }
      return errorResponse(409, "note_conflict", "Note version conflict", result);
    }
    return errorResponse(405, "method_not_allowed", "Method not allowed");
  } catch (error) {
    if (error instanceof InvalidRequestError) {
      return errorResponse(400, "invalid_request", error.message);
    }
    if (isConstraintError(error)) {
      return errorResponse(
        409,
        "constraint_violation",
        "The note conflicts with existing data",
      );
    }
    throw error;
  }
}
