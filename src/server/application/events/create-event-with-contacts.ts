import { getContactByKey } from "../../db/contact.js";
import { runInImmediateTransaction } from "../../db/client.js";
import { insertEventWithGeneratedKey } from "../../db/event.js";
import { insertEventContactWithGeneratedKey } from "../../db/event-contacts.js";
import {
  createEventWithContacts as createEventAndContacts,
  type EventWithContacts,
  type NewEventContact,
} from "../../db/event-service.js";
import type { NewEventRecord } from "../../db/types.js";
import { isUtcIsoTimestamp } from "../timestamps.js";

export type CreateEventWithContactsResult =
  | ({ status: "created" } & EventWithContacts)
  | { status: "contact_not_found"; contactKey: number }
  | { status: "duplicate_contact"; contactKey: number }
  | { status: "invalid_range" }
  | { status: "invalid_timestamp"; field: "start" | "end" };

export function createEventWithGeneratedKeys(
  event: Omit<NewEventRecord, "key" | "version">,
  contacts: readonly {
    contact_key: number;
    role?: string | null;
  }[],
): CreateEventWithContactsResult {
  if (!isUtcIsoTimestamp(event.start)) {
    return { status: "invalid_timestamp", field: "start" };
  }
  if (!isUtcIsoTimestamp(event.end)) {
    return { status: "invalid_timestamp", field: "end" };
  }
  if (event.end <= event.start) {
    return { status: "invalid_range" };
  }

  return runInImmediateTransaction(() => {
    const assignedContacts = new Set<number>();
    for (const link of contacts) {
      if (assignedContacts.has(link.contact_key)) {
        return {
          status: "duplicate_contact",
          contactKey: link.contact_key,
        };
      }
      assignedContacts.add(link.contact_key);
      if (!getContactByKey(link.contact_key)) {
        return {
          status: "contact_not_found",
          contactKey: link.contact_key,
        };
      }
    }

    const createdEvent = insertEventWithGeneratedKey(event);
    const createdContacts = contacts.map((link) =>
      insertEventContactWithGeneratedKey({
        event_key: createdEvent.key,
        contact_key: link.contact_key,
        role: link.role ?? null,
      })
    );
    return {
      status: "created",
      event: createdEvent,
      contacts: createdContacts,
    };
  });
}

export function createEventWithContacts(
  event: NewEventRecord,
  contacts: readonly NewEventContact[],
): CreateEventWithContactsResult {
  if (!isUtcIsoTimestamp(event.start)) {
    return { status: "invalid_timestamp", field: "start" };
  }
  if (!isUtcIsoTimestamp(event.end)) {
    return { status: "invalid_timestamp", field: "end" };
  }
  if (event.end <= event.start) {
    return { status: "invalid_range" };
  }

  return runInImmediateTransaction(() => {
    const assignedContacts = new Set<number>();
    for (const link of contacts) {
      if (assignedContacts.has(link.contact_key)) {
        return {
          status: "duplicate_contact",
          contactKey: link.contact_key,
        };
      }
      assignedContacts.add(link.contact_key);

      if (!getContactByKey(link.contact_key)) {
        return {
          status: "contact_not_found",
          contactKey: link.contact_key,
        };
      }
    }

    return {
      status: "created",
      ...createEventAndContacts(event, contacts),
    };
  });
}
