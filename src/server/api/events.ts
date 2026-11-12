import { createEventWithGeneratedKeys } from "../application/events/create-event-with-contacts.js";
import { deleteEventWithContacts } from "../application/events/delete-event-with-contacts.js";
import {
  updateEventWithContacts,
  type EventContactChange,
} from "../application/events/update-event-with-contacts.js";
import {
  listAllEvents,
  searchEventsByName,
} from "../application/events/list-events.js";
import { getContactByKey } from "../db/contact.js";
import { getEventContactsForEvent } from "../db/event-contacts.js";
import { getEventByKey } from "../db/event.js";
import type { EventRecord } from "../db/types.js";
import type { ApiResponse } from "./contacts.js";

type EventFields = Omit<EventRecord, "key" | "version">;
type EventChanges = Partial<EventFields>;

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
    if (!allowed.has(key)) throw new InvalidRequestError(`Unexpected field: ${key}`);
  }
  for (const key of required) {
    if (!(key in value)) throw new InvalidRequestError(`Missing field: ${key}`);
  }
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

function nullableString(value: unknown, field: string): string | null {
  if (value !== null && typeof value !== "string") {
    throw new InvalidRequestError(`${field} must be a string or null`);
  }
  return value;
}

function bodyObject(body: unknown): Record<string, unknown> {
  if (!isObject(body)) {
    throw new InvalidRequestError("Request body must be a JSON object");
  }
  return body;
}

function parseEvent(value: unknown): EventFields {
  if (!isObject(value)) throw new InvalidRequestError("event must be an object");
  assertKeys(value, ["name", "start", "end", "comment"]);
  return {
    name: nonEmptyString(value.name, "event.name"),
    start: nonEmptyString(value.start, "event.start"),
    end: nonEmptyString(value.end, "event.end"),
    comment: nullableString(value.comment, "event.comment"),
  };
}

function parseChanges(value: unknown): EventChanges {
  if (!isObject(value)) throw new InvalidRequestError("changes must be an object");
  assertKeys(value, [], ["name", "start", "end", "comment"]);
  const changes: EventChanges = {};
  if ("name" in value) changes.name = nonEmptyString(value.name, "changes.name");
  if ("start" in value) changes.start = nonEmptyString(value.start, "changes.start");
  if ("end" in value) changes.end = nonEmptyString(value.end, "changes.end");
  if ("comment" in value) {
    changes.comment = nullableString(value.comment, "changes.comment");
  }
  return changes;
}

function parseContacts(value: unknown): {
  contact_key: number;
  role: string | null;
}[] {
  if (!Array.isArray(value)) {
    throw new InvalidRequestError("contacts must be an array");
  }
  return value.map((item, index) => {
    const field = `contacts[${index}]`;
    if (!isObject(item)) throw new InvalidRequestError(`${field} must be an object`);
    assertKeys(item, ["contactKey"], ["role"]);
    return {
      contact_key: positiveInteger(item.contactKey, `${field}.contactKey`),
      role: "role" in item ? nullableString(item.role, `${field}.role`) : null,
    };
  });
}

function parseContactChanges(value: unknown): readonly EventContactChange[] {
  if (!Array.isArray(value)) {
    throw new InvalidRequestError("contactChanges must be an array");
  }
  return value.map((item, index): EventContactChange => {
    const field = `contactChanges[${index}]`;
    if (!isObject(item) || typeof item.type !== "string") {
      throw new InvalidRequestError(`${field}.type must be a string`);
    }
    if (item.type === "add") {
      assertKeys(item, ["type", "contactKey"], ["role"]);
      return {
        type: "add",
        contactKey: positiveInteger(item.contactKey, `${field}.contactKey`),
        role: "role" in item ? nullableString(item.role, `${field}.role`) : null,
      };
    }
    if (item.type === "update") {
      assertKeys(item, ["type", "key", "expectedVersion", "changes"]);
      if (!isObject(item.changes)) {
        throw new InvalidRequestError(`${field}.changes must be an object`);
      }
      assertKeys(item.changes, [], ["role"]);
      const changes: { role?: string | null } = {};
      if ("role" in item.changes) {
        changes.role = nullableString(item.changes.role, `${field}.changes.role`);
      }
      return {
        type: "update",
        key: positiveInteger(item.key, `${field}.key`),
        expectedVersion: nonNegativeInteger(
          item.expectedVersion,
          `${field}.expectedVersion`,
        ),
        changes,
      };
    }
    if (item.type === "delete") {
      assertKeys(item, ["type", "key", "expectedVersion"]);
      return {
        type: "delete",
        key: positiveInteger(item.key, `${field}.key`),
        expectedVersion: nonNegativeInteger(
          item.expectedVersion,
          `${field}.expectedVersion`,
        ),
      };
    }
    throw new InvalidRequestError(`${field}.type must be add, update, or delete`);
  });
}

function eventDetail(event: EventRecord) {
  return {
    event,
    contacts: getEventContactsForEvent(event.key).map((link) => {
      const contact = getContactByKey(link.contact_key);
      if (!contact) {
        throw new Error(
          `Event contact ${link.key} references missing contact ${link.contact_key}`,
        );
      }
      return { ...link, contact };
    }),
  };
}

function isConstraintError(error: unknown): boolean {
  return isObject(error) &&
    typeof error.code === "string" &&
    error.code.startsWith("SQLITE_CONSTRAINT_");
}

export function handleEventsApiRequest(
  method: string,
  url: URL,
  body?: unknown,
): ApiResponse {
  try {
    if (url.pathname === "/api/events") {
      if (method === "GET") {
        const search = url.searchParams.get("name");
        return {
          status: 200,
          body: {
            events: search?.trim()
              ? searchEventsByName(search)
              : listAllEvents(),
          },
        };
      }
      if (method === "POST") {
        const request = bodyObject(body);
        assertKeys(request, ["event"], ["contacts"]);
        const result = createEventWithGeneratedKeys(
          parseEvent(request.event),
          parseContacts(request.contacts ?? []),
        );
        if (result.status === "invalid_timestamp") {
          throw new InvalidRequestError(
            `event.${result.field} must be a UTC ISO-8601 timestamp`,
          );
        }
        if (result.status === "invalid_range") {
          throw new InvalidRequestError(
            "event.end must be later than event.start",
          );
        }
        if (result.status === "contact_not_found") {
          return errorResponse(404, result.status, "Contact not found", result);
        }
        if (result.status === "duplicate_contact") {
          return errorResponse(
            409,
            result.status,
            "A contact can only be assigned to an event once",
            result,
          );
        }
        return { status: 201, body: eventDetail(result.event) };
      }
      return errorResponse(405, "method_not_allowed", "Method not allowed");
    }

    const match = /^\/api\/events\/([1-9]\d*)$/.exec(url.pathname);
    if (!match) return errorResponse(404, "not_found", "API route not found");
    const key = Number(match[1]);
    if (!Number.isSafeInteger(key)) {
      throw new InvalidRequestError("Event key must be a safe integer");
    }

    if (method === "GET") {
      const event = getEventByKey(key);
      return event
        ? { status: 200, body: eventDetail(event) }
        : errorResponse(404, "event_not_found", "Event not found");
    }
    if (method === "PATCH") {
      const request = bodyObject(body);
      assertKeys(request, ["expectedVersion", "changes", "contactChanges"]);
      const result = updateEventWithContacts({
        eventKey: key,
        expectedVersion: nonNegativeInteger(
          request.expectedVersion,
          "expectedVersion",
        ),
        changes: parseChanges(request.changes),
        contactChanges: parseContactChanges(request.contactChanges),
      });
      if (result.status === "updated") {
        const event = getEventByKey(key);
        if (!event) throw new Error("Updated event could not be reloaded");
        return { status: 200, body: eventDetail(event) };
      }
      if (result.status === "event_not_found") {
        return errorResponse(404, result.status, "Event not found");
      }
      if (result.status === "invalid_range") {
        return errorResponse(
          400,
          "invalid_request",
          "event end must be later than its start",
        );
      }
      if (result.status === "invalid_timestamp") {
        return errorResponse(
          400,
          "invalid_request",
          `event.${result.field} must be a UTC ISO-8601 timestamp`,
        );
      }
      if (result.status === "link_not_found") {
        return errorResponse(
          404,
          "event_contact_not_found",
          "Event contact assignment not found",
          result,
        );
      }
      if (result.status === "contact_not_found") {
        return errorResponse(404, result.status, "Contact not found", result);
      }
      return errorResponse(
        409,
        result.status,
        "Event or contact assignment conflict",
        result,
      );
    }
    if (method === "DELETE") {
      const request = bodyObject(body);
      assertKeys(request, ["expectedVersion"]);
      const result = deleteEventWithContacts(
        key,
        nonNegativeInteger(request.expectedVersion, "expectedVersion"),
      );
      if (result.status === "deleted") {
        return {
          status: 200,
          body: { status: result.status, event: result.record },
        };
      }
      if (result.status === "not_found") {
        return errorResponse(404, "event_not_found", "Event not found");
      }
      return errorResponse(409, "event_conflict", "Event version conflict", result);
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
        "The event or contact assignment conflicts with existing data",
      );
    }
    throw error;
  }
}
