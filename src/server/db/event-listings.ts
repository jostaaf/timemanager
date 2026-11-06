import { db } from "./client.js";
import type { ContactRecord, EventRecord } from "./types.js";

function containsPattern(value: string): string {
  return `%${value.replace(/[!%_]/g, "!$&")}%`;
}

export function listEvents(): EventRecord[] {
  return db
    .prepare<[], EventRecord>(
      `SELECT *
       FROM event
       ORDER BY "start", "end", "key"`,
    )
    .all();
}

export function listEventsInRange(
  fromInclusive: string,
  toExclusive: string,
): EventRecord[] {
  return db
    .prepare<[string, string], EventRecord>(
      `SELECT *
       FROM event
       WHERE "start" >= ? AND "start" < ?
       ORDER BY "start", "end", "key"`,
    )
    .all(fromInclusive, toExclusive);
}

export function listUpcomingEvents(fromInclusive: string): EventRecord[] {
  return db
    .prepare<[string], EventRecord>(
      `SELECT *
       FROM event
       WHERE "start" >= ?
       ORDER BY "start", "end", "key"`,
    )
    .all(fromInclusive);
}

export function searchEventsByName(name: string): EventRecord[] {
  return db
    .prepare<[string], EventRecord>(
      `SELECT *
       FROM event
       WHERE "name" LIKE ? ESCAPE '!' COLLATE NOCASE
       ORDER BY "start", "end", "key"`,
    )
    .all(containsPattern(name));
}

export function listEventsForContact(contactKey: number): EventRecord[] {
  return db
    .prepare<[number], EventRecord>(
      `SELECT event.*
       FROM event
       WHERE EXISTS (
         SELECT 1
         FROM event_contacts
         WHERE event_contacts."event_key" = event."key"
           AND event_contacts."contact_key" = ?
       )
       ORDER BY event."start", event."end", event."key"`,
    )
    .all(contactKey);
}

interface EventWithContactRow {
  event_key: number;
  event_version: number;
  event_name: string;
  event_start: string;
  event_end: string;
  event_comment: string | null;
  contact_key: number | null;
  contact_version: number | null;
  contact_name: string | null;
  contact_street: string | null;
  contact_postcode: number | string | null;
  contact_city: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  contact_tag: string | null;
  contact_comment: string | null;
  role: string | null;
}

export interface EventWithContactsListing {
  event: EventRecord;
  contacts: { contact: ContactRecord; role: string | null }[];
}

export function listEventsWithContacts(): EventWithContactsListing[] {
  const rows = db
    .prepare<[], EventWithContactRow>(
      `SELECT
         event."key" AS event_key,
         event."version" AS event_version,
         event."name" AS event_name,
         event."start" AS event_start,
         event."end" AS event_end,
         event."comment" AS event_comment,
         contact."key" AS contact_key,
         contact."version" AS contact_version,
         contact."name" AS contact_name,
         contact."street" AS contact_street,
         contact."postcode" AS contact_postcode,
         contact."city" AS contact_city,
         contact."phone" AS contact_phone,
         contact."email" AS contact_email,
         contact."tag" AS contact_tag,
         contact."comment" AS contact_comment,
         event_contacts."role" AS role
       FROM event
       LEFT JOIN event_contacts
         ON event_contacts."event_key" = event."key"
       LEFT JOIN contact
         ON contact."key" = event_contacts."contact_key"
       ORDER BY event."start", event."end", event."key",
         contact."name" COLLATE NOCASE, contact."key"`,
    )
    .all();

  const byEvent = new Map<number, EventWithContactsListing>();
  for (const row of rows) {
    let listing = byEvent.get(row.event_key);
    if (!listing) {
      listing = {
        event: {
          key: row.event_key,
          version: row.event_version,
          name: row.event_name,
          start: row.event_start,
          end: row.event_end,
          comment: row.event_comment,
        },
        contacts: [],
      };
      byEvent.set(row.event_key, listing);
    }

    if (
      row.contact_key !== null &&
      row.contact_version !== null &&
      row.contact_name !== null &&
      row.contact_street !== null &&
      row.contact_postcode !== null &&
      row.contact_city !== null
    ) {
      listing.contacts.push({
        contact: {
          key: row.contact_key,
          version: row.contact_version,
          name: row.contact_name,
          street: row.contact_street,
          postcode: row.contact_postcode,
          city: row.contact_city,
          phone: row.contact_phone,
          email: row.contact_email,
          tag: row.contact_tag,
          comment: row.contact_comment,
        },
        role: row.role,
      });
    }
  }

  return [...byEvent.values()];
}

export function listEventsWithoutContacts(): EventRecord[] {
  return db
    .prepare<[], EventRecord>(
      `SELECT event.*
       FROM event
       WHERE NOT EXISTS (
         SELECT 1
         FROM event_contacts
         WHERE event_contacts."event_key" = event."key"
       )
       ORDER BY event."start", event."end", event."key"`,
    )
    .all();
}
