import { getContactByKey } from "../../db/contact.js";
import {
  getEventContactByPair,
  insertEventContact,
} from "../../db/event-contacts.js";
import { getEventByKey } from "../../db/event.js";
import { runInImmediateTransaction } from "../../db/client.js";
import type { EventContactsRecord } from "../../db/types.js";

export interface AddContactToEventInput {
  linkKey: number;
  eventKey: number;
  contactKey: number;
  role?: string | null;
}

export type AddContactToEventResult =
  | { status: "added"; record: EventContactsRecord }
  | { status: "already_assigned"; record: EventContactsRecord }
  | { status: "event_not_found" }
  | { status: "contact_not_found" };

export function addContactToEvent(
  input: AddContactToEventInput,
): AddContactToEventResult {
  return runInImmediateTransaction(() => {
    if (!getEventByKey(input.eventKey)) {
      return { status: "event_not_found" };
    }
    if (!getContactByKey(input.contactKey)) {
      return { status: "contact_not_found" };
    }

    const existing = getEventContactByPair(input.eventKey, input.contactKey);
    if (existing) {
      return { status: "already_assigned", record: existing };
    }

    const record = insertEventContact({
      key: input.linkKey,
      event_key: input.eventKey,
      contact_key: input.contactKey,
      role: input.role ?? null,
    });
    return { status: "added", record };
  });
}
