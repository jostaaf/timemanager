import { getContactByKey } from "../../db/contact.js";
import { runInImmediateTransaction } from "../../db/client.js";
import {
  createEventWithContacts as createEventAndContacts,
  type EventWithContacts,
  type NewEventContact,
} from "../../db/event-service.js";
import type { NewEventRecord } from "../../db/types.js";
import { isUtcIsoTimestamp } from "./timestamps.js";

export type CreateEventWithContactsResult =
  | ({ status: "created" } & EventWithContacts)
  | { status: "contact_not_found"; contactKey: number }
  | { status: "duplicate_contact"; contactKey: number }
  | { status: "invalid_timestamp"; field: "start" | "end" };

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
