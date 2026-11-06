import { getContactByKey } from "../../db/contact.js";
import { runInImmediateTransaction } from "../../db/client.js";
import { getEventByKey, updateEvent } from "../../db/event.js";
import {
  deleteEventContact,
  getEventContactByKey,
  getEventContactByPair,
  getEventContactsForEvent,
  insertEventContact,
  updateEventContact,
} from "../../db/event-contacts.js";
import type {
  EventContactsRecord,
  EventContactsUpdate,
  EventRecord,
  EventUpdate,
} from "../../db/types.js";
import { isUtcIsoTimestamp } from "../timestamps.js";

type NewLink = {
  type: "add";
  key: number;
  contactKey: number;
  role?: string | null;
};

type UpdateLink = {
  type: "update";
  key: number;
  expectedVersion: number;
  changes: Pick<EventContactsUpdate, "role">;
};

type DeleteLink = {
  type: "delete";
  key: number;
  expectedVersion: number;
};

export type EventContactChange = NewLink | UpdateLink | DeleteLink;

export interface UpdateEventWithContactsInput {
  eventKey: number;
  expectedVersion: number;
  changes: EventUpdate;
  contactChanges: readonly EventContactChange[];
}

export type UpdateEventWithContactsResult =
  | {
      status: "updated";
      event: EventRecord;
      contacts: EventContactsRecord[];
    }
  | { status: "event_not_found" }
  | { status: "event_conflict"; currentVersion: number }
  | { status: "invalid_timestamp"; field: "start" | "end" }
  | { status: "contact_not_found"; contactKey: number }
  | { status: "duplicate_contact"; contactKey: number }
  | { status: "link_not_found"; linkKey: number }
  | {
      status: "link_conflict";
      linkKey: number;
      currentVersion: number;
    }
  | { status: "duplicate_link_change"; linkKey: number };

export function updateEventWithContacts(
  input: UpdateEventWithContactsInput,
): UpdateEventWithContactsResult {
  return runInImmediateTransaction(() => {
    const event = getEventByKey(input.eventKey);
    if (!event) {
      return { status: "event_not_found" };
    }
    if (event.version !== input.expectedVersion) {
      return { status: "event_conflict", currentVersion: event.version };
    }
    const updatedStart = input.changes.start ?? event.start;
    const updatedEnd = input.changes.end ?? event.end;
    if (!isUtcIsoTimestamp(updatedStart)) {
      return { status: "invalid_timestamp", field: "start" };
    }
    if (!isUtcIsoTimestamp(updatedEnd)) {
      return { status: "invalid_timestamp", field: "end" };
    }

    const changedLinkKeys = new Set<number>();
    const linksToRemove = new Set<number>();
    const contactsToAdd = new Set<number>();

    for (const change of input.contactChanges) {
      if (change.type === "add") {
        if (contactsToAdd.has(change.contactKey)) {
          return {
            status: "duplicate_contact",
            contactKey: change.contactKey,
          };
        }
        contactsToAdd.add(change.contactKey);
        if (!getContactByKey(change.contactKey)) {
          return {
            status: "contact_not_found",
            contactKey: change.contactKey,
          };
        }
        continue;
      }

      if (changedLinkKeys.has(change.key)) {
        return { status: "duplicate_link_change", linkKey: change.key };
      }
      changedLinkKeys.add(change.key);

      const link = getEventContactByKey(change.key);
      if (!link || link.event_key !== input.eventKey) {
        return { status: "link_not_found", linkKey: change.key };
      }
      if (link.version !== change.expectedVersion) {
        return {
          status: "link_conflict",
          linkKey: change.key,
          currentVersion: link.version,
        };
      }
      if (change.type === "delete") {
        linksToRemove.add(change.key);
      }
    }

    const resultingContactKeys = new Set(
      getEventContactsForEvent(input.eventKey)
        .filter((link) => !linksToRemove.has(link.key))
        .map((link) => link.contact_key),
    );
    for (const contactKey of contactsToAdd) {
      if (resultingContactKeys.has(contactKey)) {
        return { status: "duplicate_contact", contactKey };
      }
      resultingContactKeys.add(contactKey);
    }

    const eventResult = updateEvent(
      input.eventKey,
      input.expectedVersion,
      input.changes,
    );
    if (eventResult.status !== "updated") {
      throw new Error("Event changed during an immediate transaction");
    }

    for (const change of input.contactChanges) {
      if (change.type === "add") {
        insertEventContact({
          key: change.key,
          event_key: input.eventKey,
          contact_key: change.contactKey,
          role: change.role ?? null,
        });
      } else if (change.type === "update") {
        const result = updateEventContact(
          change.key,
          change.expectedVersion,
          change.changes,
        );
        if (result.status !== "updated") {
          throw new Error("Event contact changed during an immediate transaction");
        }
      } else {
        const result = deleteEventContact(
          change.key,
          change.expectedVersion,
        );
        if (result.status !== "deleted") {
          throw new Error("Event contact changed during an immediate transaction");
        }
      }
    }

    return {
      status: "updated",
      event: eventResult.record,
      contacts: getEventContactsForEvent(input.eventKey),
    };
  });
}
