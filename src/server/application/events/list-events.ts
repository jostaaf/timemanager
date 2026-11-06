import {
  listEvents,
  listEventsForContact as queryEventsForContact,
  listEventsInRange as queryEventsInRange,
  listEventsWithContacts as queryEventsWithContacts,
  listEventsWithoutContacts as queryEventsWithoutContacts,
  searchEventsByName as queryEventsByName,
  listUpcomingEvents as queryUpcomingEvents,
  type EventWithContactsListing,
} from "../../db/event-listings.js";
import type { EventRecord } from "../../db/types.js";
import { assertUtcIsoTimestamp } from "./timestamps.js";

export function listAllEvents(): EventRecord[] {
  return listEvents();
}

export function listEventsInRange(
  fromInclusive: string,
  toExclusive: string,
): EventRecord[] {
  assertUtcIsoTimestamp(fromInclusive, "start");
  assertUtcIsoTimestamp(toExclusive, "end");
  if (fromInclusive >= toExclusive) {
    throw new RangeError("Event range end must be later than its start");
  }
  return queryEventsInRange(fromInclusive, toExclusive);
}

export function listUpcomingEvents(
  fromInclusive: string = new Date().toISOString(),
): EventRecord[] {
  assertUtcIsoTimestamp(fromInclusive, "start");
  return queryUpcomingEvents(fromInclusive);
}

export function searchEventsByName(name: string): EventRecord[] {
  const search = name.trim();
  return search.length === 0 ? [] : queryEventsByName(search);
}

export function listEventsForContact(contactKey: number): EventRecord[] {
  return queryEventsForContact(contactKey);
}

export function listEventsWithContacts(): EventWithContactsListing[] {
  return queryEventsWithContacts();
}

export function listEventsWithoutContacts(): EventRecord[] {
  return queryEventsWithoutContacts();
}
