import { db } from "./client.js";
import { insertEvent } from "./event.js";
import { insertEventContact } from "./event-contacts.js";
import type {
  EventContactsRecord,
  EventRecord,
  NewEventContactsRecord,
  NewEventRecord,
} from "./types.js";

export type NewEventContact = Omit<NewEventContactsRecord, "event_key">;

export interface EventWithContacts {
  event: EventRecord;
  contacts: EventContactsRecord[];
}

export function createEventWithContacts(
  event: NewEventRecord,
  contacts: readonly NewEventContact[],
): EventWithContacts {
  return db.transaction(() => {
    const createdEvent = insertEvent(event);
    const createdContacts = contacts.map((contact) =>
      insertEventContact({ ...contact, event_key: createdEvent.key }),
    );
    return { event: createdEvent, contacts: createdContacts };
  })();
}
