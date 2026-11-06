import { test } from "node:test";
import {
  assert,
  addContactToEvent,
  contact,
  countRows,
  createContactWithSocials,
  createEventApplication,
  createEventWithContacts,
  db,
  deleteContact,
  deleteEvent,
  deleteEventWithContacts,
  event,
  eventContact,
  insertContact,
  insertEvent,
  insertEventContact,
  listAllEvents,
  listEventsForContact,
  listEventsInRange,
  listEventsWithContacts,
  listEventsWithoutContacts,
  listUpcomingEvents,
  searchEventsByName,
  updateEventWithContacts,
} from "./test-fixtures.mjs";

test("event aggregate inserts atomically and rolls back on invalid contact", () => {
  insertContact(contact(4001));
  const created = createEventWithContacts(event(4002), [
    {
      key: 4003,
      version: 1,
      contact_key: 4001,
      role: "host",
    },
  ]);
  assert.equal(created.contacts.length, 1);
  assert.equal(created.contacts[0].event_key, 4002);

  assert.throws(
    () =>
      createEventWithContacts(event(4004), [
        {
          key: 4005,
          version: 1,
          contact_key: -1,
          role: null,
        },
      ]),
    { code: "SQLITE_CONSTRAINT_FOREIGNKEY" },
  );
  assert.equal(countRows("event", "key", 4004), 0);
  assert.equal(countRows("event_contacts", "key", 4005), 0);
});


test("application creates event with unique existing contacts", () => {
  insertContact(contact(4101));

  const created = createEventApplication(event(4102), [
    { key: 4103, version: 1, contact_key: 4101, role: "host" },
  ]);
  assert.equal(created.status, "created");
  assert.equal(created.event.key, 4102);
  assert.equal(created.contacts.length, 1);
  assert.equal(created.contacts[0].event_key, 4102);

  assert.deepEqual(
    createEventApplication(event(4104), [
      { key: 4105, version: 1, contact_key: 4101, role: null },
      { key: 4106, version: 1, contact_key: 4101, role: "duplicate" },
    ]),
    { status: "duplicate_contact", contactKey: 4101 },
  );
  assert.equal(countRows("event", "key", 4104), 0);

  assert.deepEqual(
    createEventApplication(event(4107), [
      { key: 4108, version: 1, contact_key: -1, role: null },
    ]),
    { status: "contact_not_found", contactKey: -1 },
  );
  assert.equal(countRows("event", "key", 4107), 0);
});


test("application updates event and contact links atomically", () => {
  insertContact(contact(4201));
  insertContact(contact(4202));
  insertContact(contact(4203));
  const created = createEventApplication(event(4204), [
    { key: 4205, version: 1, contact_key: 4201, role: "old role" },
    { key: 4206, version: 1, contact_key: 4202, role: null },
  ]);
  assert.equal(created.status, "created");

  const staleLink = updateEventWithContacts({
    eventKey: 4204,
    expectedVersion: 1,
    changes: { name: "Must roll back" },
    contactChanges: [
      {
        type: "update",
        key: 4205,
        expectedVersion: 9,
        changes: { role: "stale" },
      },
    ],
  });
  assert.deepEqual(staleLink, {
    status: "link_conflict",
    linkKey: 4205,
    currentVersion: 1,
  });
  assert.equal(
    db.prepare('SELECT "name" FROM event WHERE "key" = ?').get(4204).name,
    "Event 4204",
  );

  assert.deepEqual(
    updateEventWithContacts({
      eventKey: 4204,
      expectedVersion: 1,
      changes: { name: "Duplicate assignment" },
      contactChanges: [
        { type: "add", key: 4207, contactKey: 4201 },
      ],
    }),
    { status: "duplicate_contact", contactKey: 4201 },
  );

  const updated = updateEventWithContacts({
    eventKey: 4204,
    expectedVersion: created.event.version,
    changes: { name: "Updated application event" },
    contactChanges: [
      {
        type: "update",
        key: 4205,
        expectedVersion: 1,
        changes: { role: "updated role" },
      },
      { type: "delete", key: 4206, expectedVersion: 1 },
      {
        type: "add",
        key: 4208,
        contactKey: 4203,
        role: "guest",
      },
    ],
  });
  assert.equal(updated.status, "updated");
  assert.equal(updated.event.version, 2);
  assert.equal(updated.event.name, "Updated application event");
  assert.deepEqual(
    updated.contacts.map((link) => [
      link.key,
      link.version,
      link.contact_key,
      link.role,
    ]),
    [
      [4205, 2, 4201, "updated role"],
      [4208, 1, 4203, "guest"],
    ],
  );
});


test("application deletes event and cascades contact links", () => {
  insertContact(contact(4301));
  const created = createEventApplication(event(4302), [
    { key: 4303, version: 1, contact_key: 4301, role: null },
  ]);
  assert.equal(created.status, "created");

  assert.deepEqual(deleteEventWithContacts(4302, 0), {
    status: "conflict",
    currentVersion: 1,
  });
  assert.equal(deleteEventWithContacts(4302, 1).status, "deleted");
  assert.equal(countRows("event", "key", 4302), 0);
  assert.equal(countRows("event_contacts", "event_key", 4302), 0);
  assert.deepEqual(deleteEventWithContacts(4302, 1), { status: "not_found" });
});


test("application event listings cover all, time, name, and contact queries", () => {
  const person = insertContact(contact(4801));
  const secondPerson = insertContact(contact(4802));
  const first = {
    ...event(4803),
    name: "Planning Meeting",
    start: "2026-04-01T09:00:00.000Z",
    end: "2026-04-01T10:00:00.000Z",
  };
  const second = {
    ...event(4804),
    name: "Planning Follow-up",
    start: "2026-04-01T12:00:00.000Z",
    end: "2026-04-01T13:00:00.000Z",
  };
  const third = {
    ...event(4805),
    name: "Personal",
    start: "2026-04-02T09:00:00.000Z",
    end: "2026-04-02T10:00:00.000Z",
  };
  insertEvent(first);
  insertEvent(second);
  insertEvent(third);
  insertEventContact(eventContact(4806, first.key, person.key));
  insertEventContact(eventContact(4807, first.key, secondPerson.key));
  insertEventContact(eventContact(4808, second.key, person.key));

  assert.deepEqual(
    listAllEvents()
      .filter((record) => record.key >= 4803)
      .map((record) => record.key),
    [4803, 4804, 4805],
  );
  assert.deepEqual(
    listEventsInRange(
      "2026-04-01T09:00:00.000Z",
      "2026-04-01T12:00:00.000Z",
    ).map((record) => record.key),
    [4803],
  );
  assert.deepEqual(
    listUpcomingEvents("2026-04-01T10:00:00.000Z").map(
      (record) => record.key,
    ),
    [4804, 4805],
  );
  assert.deepEqual(
    searchEventsByName("planning").map((record) => record.key),
    [4803, 4804],
  );
  assert.deepEqual(
    searchEventsByName("%"),
    [],
  );
  assert.deepEqual(
    listEventsForContact(person.key).map((record) => record.key),
    [4803, 4804],
  );

  const withContacts = listEventsWithContacts().filter(
    (listing) => listing.event.key >= 4803 && listing.event.key <= 4805,
  );
  assert.deepEqual(
    withContacts.map(({ event: record, contacts }) => [
      record.key,
      contacts.map(({ contact: linkedContact, role }) => [
        linkedContact.key,
        role,
      ]),
    ]),
    [
      [4803, [[person.key, null], [secondPerson.key, null]]],
      [4804, [[person.key, null]]],
      [4805, []],
    ],
  );
  assert.deepEqual(
    listEventsWithoutContacts()
      .filter((record) => record.key >= 4803 && record.key <= 4805)
      .map((record) => record.key),
    [4805],
  );

  assert.throws(
    () => listEventsInRange("2026-04-01", "2026-04-02T00:00:00.000Z"),
    /UTC ISO-8601 timestamp/,
  );
  assert.throws(
    () =>
      listEventsInRange(
        "2026-04-02T00:00:00.000Z",
        "2026-04-01T00:00:00.000Z",
      ),
    /later than its start/,
  );
});


test("application use case adds a contact to an event at most once", () => {
  insertContact(contact(4501));
  insertEvent(event(4502));

  const added = addContactToEvent({
    linkKey: 4503,
    eventKey: 4502,
    contactKey: 4501,
    role: "host",
  });
  assert.equal(added.status, "added");
  assert.deepEqual(added.record, {
    ...eventContact(4503, 4502, 4501),
    role: "host",
  });
  assert.deepEqual(
    addContactToEvent({
      linkKey: 4504,
      eventKey: 4502,
      contactKey: 4501,
      role: "attendee",
    }),
    { status: "already_assigned", record: added.record },
  );
  assert.equal(countRows("event_contacts", "event_key", 4502), 1);
  assert.equal(countRows("event_contacts", "key", 4504), 0);
});


test("application use case reports missing event and contact", () => {
  insertEvent(event(4601));
  insertContact(contact(4602));

  assert.deepEqual(
    addContactToEvent({
      linkKey: 4603,
      eventKey: -1,
      contactKey: 4602,
    }),
    { status: "event_not_found" },
  );
  assert.deepEqual(
    addContactToEvent({
      linkKey: 4604,
      eventKey: 4601,
      contactKey: -1,
    }),
    { status: "contact_not_found" },
  );
  assert.equal(countRows("event_contacts", "key", 4603), 0);
  assert.equal(countRows("event_contacts", "key", 4604), 0);
});


test("parent deletion preserves the other parent and cascades only child rows", () => {
  const contactWithSocial = createContactWithSocials(contact(5001), [
    {
      key: 5003,
      version: 1,
      media: "example",
      userid: null,
      comment: null,
    },
  ]);
  const eventWithContact = createEventWithContacts(event(5002), [
    {
      key: 5004,
      version: 1,
      contact_key: contactWithSocial.contact.key,
      role: null,
    },
  ]);

  assert.deepEqual(deleteContact(5001, 1).status, "deleted");
  assert.equal(countRows("contact_socials", "contact_key", 5001), 0);
  assert.equal(countRows("event_contacts", "contact_key", 5001), 0);
  assert.equal(countRows("event", "key", eventWithContact.event.key), 1);

  assert.deepEqual(deleteEvent(5002, 1).status, "deleted");
  assert.equal(countRows("event_contacts", "event_key", 5002), 0);
});


test("contacts and events may exist without relationship rows", () => {
  insertContact(contact(6001));
  insertEvent(event(6002));

  assert.equal(countRows("event_contacts", "contact_key", 6001), 0);
  assert.equal(countRows("event_contacts", "event_key", 6002), 0);
});
