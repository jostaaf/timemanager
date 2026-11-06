import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "timemanager-db-tests-"));
const testDatabasePath = join(temporaryDirectory, "test.db");
const sourceDatabasePath = fileURLToPath(
  new URL("../database/timemanager.db", import.meta.url),
);

const sourceDatabase = new Database(sourceDatabasePath, {
  readonly: true,
  fileMustExist: true,
});
const schema = sourceDatabase
  .prepare(
    `SELECT sql
     FROM sqlite_master
     WHERE type IN ('table', 'index', 'trigger')
       AND sql IS NOT NULL
       AND name NOT LIKE 'sqlite_%'
     ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`,
  )
  .all();
sourceDatabase.close();

const schemaDatabase = new Database(testDatabasePath);
for (const { sql } of schema) {
  schemaDatabase.exec(sql);
}
schemaDatabase.pragma("foreign_keys = ON");
assert.deepEqual(schemaDatabase.pragma("foreign_key_check"), []);
schemaDatabase.close();

process.env.TIMEMANAGER_DB_PATH = testDatabasePath;

const { db } = await import("../dist/server/db/client.js");
const { insertContact, updateContact, deleteContact } = await import(
  "../dist/server/db/contact.js"
);
const {
  insertContactSocial,
  updateContactSocial,
  deleteContactSocial,
} = await import("../dist/server/db/contact-socials.js");
const { insertEvent, updateEvent, deleteEvent } = await import(
  "../dist/server/db/event.js"
);
const {
  insertEventContact,
  updateEventContact,
  deleteEventContact,
} = await import("../dist/server/db/event-contacts.js");
const { createContactWithSocials } = await import(
  "../dist/server/db/contact-service.js"
);
const { createEventWithContacts } = await import(
  "../dist/server/db/event-service.js"
);
const { addContactToEvent } = await import(
  "../dist/server/application/events/add-contact-to-event.js"
);
const { createContactWithSocials: createContactApplication } = await import(
  "../dist/server/application/contacts/create-contact-with-socials.js"
);
const { updateContactWithSocials } = await import(
  "../dist/server/application/contacts/update-contact-with-socials.js"
);
const { deleteContactWithSocials } = await import(
  "../dist/server/application/contacts/delete-contact-with-socials.js"
);
const { listContactsMatching } = await import(
  "../dist/server/application/contacts/list-contacts.js"
);
const { listContactsBySocialMedia } = await import(
  "../dist/server/application/contacts/list-contacts-by-social-media.js"
);
const { createEventWithContacts: createEventApplication } = await import(
  "../dist/server/application/events/create-event-with-contacts.js"
);
const { updateEventWithContacts } = await import(
  "../dist/server/application/events/update-event-with-contacts.js"
);
const { deleteEventWithContacts } = await import(
  "../dist/server/application/events/delete-event-with-contacts.js"
);
const {
  listAllEvents,
  listEventsInRange,
  listUpcomingEvents,
  searchEventsByName,
  listEventsForContact,
  listEventsWithContacts,
  listEventsWithoutContacts,
} = await import("../dist/server/application/events/list-events.js");
const { createNote: createNoteApplication } = await import(
  "../dist/server/application/notes/create-note.js"
);
const { updateNoteWithAssignments } = await import(
  "../dist/server/application/notes/update-note.js"
);
const { deleteNoteWithAssignments } = await import(
  "../dist/server/application/notes/delete-note.js"
);
const {
  listAllNotes,
  searchNotes,
  listNotesCreatedInRange,
  listUnassignedNotes,
  listNotesForContactKey,
  listNotesForEventKey,
  listNotesForContactAndEvent,
} = await import("../dist/server/application/notes/list-notes.js");
const { insertNote: insertNoteRecord, updateNote, deleteNote } = await import(
  "../dist/server/db/note.js"
);
const {
  linkNoteToContact,
  unlinkNoteFromContact,
  listContactsForNote,
  linkNoteToEvent,
  unlinkNoteFromEvent,
  listEventsForNote,
  listNotesForContact,
  listNotesForEvent,
} = await import("../dist/server/db/note-links.js");

after(() => {
  db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

function insertNote(input) {
  return insertNoteRecord({
    created_at: "2026-03-01T00:00:00.000Z",
    ...input,
  });
}

function contact(key) {
  return {
    key,
    version: 1,
    name: `Contact ${key}`,
    street: "1 Test Street",
    postcode: 12345,
    city: "Test City",
    phone: null,
    email: null,
    tag: null,
    comment: null,
  };
}

function social(key, contactKey) {
  return {
    key,
    version: 1,
    contact_key: contactKey,
    media: "example",
    userid: null,
    comment: null,
  };
}

function event(key) {
  return {
    key,
    version: 1,
    name: `Event ${key}`,
    start: "2026-01-01T09:00:00.000Z",
    end: "2026-01-01T10:00:00.000Z",
    comment: null,
  };
}

function eventContact(key, eventKey, contactKey) {
  return {
    key,
    version: 1,
    event_key: eventKey,
    contact_key: contactKey,
    role: null,
  };
}

function countRows(table, key, value) {
  return db
    .prepare(`SELECT count(*) AS count FROM "${table}" WHERE "${key}" = ?`)
    .get(value).count;
}

test("CRUD and optimistic locking work for every table", () => {
  const cases = [
    {
      insert: insertContact,
      update: updateContact,
      remove: deleteContact,
      record: contact(1001),
      changes: { name: "Updated contact" },
    },
    {
      insert: insertContactSocial,
      update: updateContactSocial,
      remove: deleteContactSocial,
      record: social(1002, 1001),
      changes: { userid: "updated-user" },
      beforeInsert: () => insertContact(contact(1001)),
    },
    {
      insert: insertEvent,
      update: updateEvent,
      remove: deleteEvent,
      record: event(1003),
      changes: { name: "Updated event" },
    },
    {
      insert: insertEventContact,
      update: updateEventContact,
      remove: deleteEventContact,
      record: eventContact(1004, 1003, 1005),
      changes: { role: "attendee" },
      beforeInsert: () => {
        insertContact(contact(1005));
        insertEvent(event(1003));
      },
    },
  ];

  for (const testCase of cases) {
    testCase.beforeInsert?.();
    assert.deepEqual(testCase.insert(testCase.record), testCase.record);

    const updated = testCase.update(
      testCase.record.key,
      testCase.record.version,
      testCase.changes,
    );
    assert.equal(updated.status, "updated");
    assert.equal(updated.record.version, 2);

    const staleUpdate = testCase.update(
      testCase.record.key,
      testCase.record.version,
      testCase.changes,
    );
    assert.deepEqual(staleUpdate, {
      status: "conflict",
      currentVersion: 2,
    });

    const currentNoopUpdate = testCase.update(
      testCase.record.key,
      2,
      {},
    );
    assert.equal(currentNoopUpdate.status, "updated");
    assert.equal(currentNoopUpdate.record.version, 2);

    assert.deepEqual(testCase.update(-testCase.record.key, 1, testCase.changes), {
      status: "not_found",
    });
    assert.deepEqual(testCase.remove(testCase.record.key, 1), {
      status: "conflict",
      currentVersion: 2,
    });

    const deleted = testCase.remove(testCase.record.key, 2);
    assert.equal(deleted.status, "deleted");
    assert.equal(deleted.record.key, testCase.record.key);
    assert.deepEqual(testCase.remove(testCase.record.key, 2), {
      status: "not_found",
    });
  }
});

test("child inserts reject references to missing parents", () => {
  assert.throws(
    () => insertContactSocial(social(2001, -1)),
    { code: "SQLITE_CONSTRAINT_FOREIGNKEY" },
  );
  assert.throws(
    () => insertEventContact(eventContact(2002, -1, -1)),
    { code: "SQLITE_CONSTRAINT_FOREIGNKEY" },
  );
});

test("contact aggregate inserts atomically and rolls back on child failure", () => {
  const created = createContactWithSocials(contact(3001), [
    {
      key: 3002,
      version: 1,
      media: "first",
      userid: null,
      comment: null,
    },
    {
      key: 3003,
      version: 1,
      media: "second",
      userid: null,
      comment: null,
    },
  ]);
  assert.equal(created.socials.length, 2);
  assert.ok(created.socials.every((item) => item.contact_key === 3001));

  assert.throws(
    () =>
      createContactWithSocials(contact(3004), [
        {
          key: 3005,
          version: 1,
          media: "valid child",
          userid: null,
          comment: null,
        },
        {
          key: 3002,
          version: 1,
          media: "duplicate key",
          userid: null,
          comment: null,
        },
      ]),
    { code: "SQLITE_CONSTRAINT_PRIMARYKEY" },
  );
  assert.equal(countRows("contact", "key", 3004), 0);
  assert.equal(countRows("contact_socials", "key", 3005), 0);
});

test("application creates contact with socials atomically", () => {
  const created = createContactApplication(contact(3501), [
    {
      key: 3502,
      version: 1,
      media: "example",
      userid: "first",
      comment: null,
    },
  ]);
  assert.equal(created.contact.key, 3501);
  assert.equal(created.socials.length, 1);
  assert.equal(created.socials[0].contact_key, 3501);

  assert.throws(
    () =>
      createContactApplication(contact(3503), [
        {
          key: 3502,
          version: 1,
          media: "duplicate",
          userid: null,
          comment: null,
        },
      ]),
    { code: "SQLITE_CONSTRAINT_PRIMARYKEY" },
  );
  assert.equal(countRows("contact", "key", 3503), 0);
});

test("application updates contact and socials atomically with optimistic locking", () => {
  const created = createContactApplication(contact(3601), [
    {
      key: 3602,
      version: 1,
      media: "first",
      userid: "old",
      comment: null,
    },
    {
      key: 3603,
      version: 1,
      media: "second",
      userid: null,
      comment: null,
    },
  ]);

  const staleSocial = updateContactWithSocials({
    contactKey: 3601,
    expectedVersion: 1,
    changes: { name: "Must roll back" },
    socialChanges: [
      {
        type: "update",
        key: 3602,
        expectedVersion: 9,
        changes: { userid: "stale" },
      },
    ],
  });
  assert.deepEqual(staleSocial, {
    status: "social_conflict",
    socialKey: 3602,
    currentVersion: 1,
  });
  assert.equal(
    db.prepare('SELECT "name" FROM contact WHERE "key" = ?').get(3601).name,
    "Contact 3601",
  );

  const updated = updateContactWithSocials({
    contactKey: 3601,
    expectedVersion: created.contact.version,
    changes: { name: "Updated application contact" },
    socialChanges: [
      {
        type: "update",
        key: 3602,
        expectedVersion: 1,
        changes: { userid: "new" },
      },
      {
        type: "delete",
        key: 3603,
        expectedVersion: 1,
      },
      {
        type: "add",
        key: 3604,
        record: {
          version: 1,
          media: "third",
          userid: null,
          comment: null,
        },
      },
    ],
  });
  assert.equal(updated.status, "updated");
  assert.equal(updated.contact.version, 2);
  assert.equal(updated.contact.name, "Updated application contact");
  assert.deepEqual(
    updated.socials.map((item) => [item.key, item.version, item.contact_key]),
    [
      [3602, 2, 3601],
      [3604, 1, 3601],
    ],
  );
});

test("application deletes contact and cascades its socials", () => {
  createContactApplication(contact(3701), [
    {
      key: 3702,
      version: 1,
      media: "example",
      userid: null,
      comment: null,
    },
  ]);

  assert.deepEqual(deleteContactWithSocials(3701, 1).status, "deleted");
  assert.equal(countRows("contact", "key", 3701), 0);
  assert.equal(countRows("contact_socials", "contact_key", 3701), 0);
  assert.deepEqual(deleteContactWithSocials(3701, 1), { status: "not_found" });
});

test("application lists all contacts and searches name, address, zip, and city", () => {
  const existingContacts = listContactsMatching().map((record) => record.key);
  insertContact({
    ...contact(3801),
    name: "Alice Example",
    street: "12 Oak Street",
    postcode: 12345,
    city: "Northville",
  });
  insertContact({
    ...contact(3802),
    name: "Bob Example",
    street: "89 Pine Road",
    postcode: 54321,
    city: "Southville",
  });
  insertContact({
    ...contact(3803),
    name: "Alicia Other",
    street: "12 Oak Avenue",
    postcode: "12-345",
    city: "Northville",
  });

  assert.deepEqual(
    listContactsMatching()
      .slice(0, 3)
      .map((record) => record.key),
    [3801, 3803, 3802],
  );
  assert.equal(listContactsMatching().length, existingContacts.length + 3);
  assert.deepEqual(
    listContactsMatching({ name: "alice" }).map((record) => record.key),
    [3801],
  );
  assert.deepEqual(
    listContactsMatching({ address: "oak" }).map((record) => record.key),
    [3801, 3803],
  );
  assert.deepEqual(
    listContactsMatching({ zip: "12-3" }).map((record) => record.key),
    [3803],
  );
  assert.deepEqual(
    listContactsMatching({ city: "NORTH" }).map((record) => record.key),
    [3801, 3803],
  );
  assert.deepEqual(
    listContactsMatching({ name: "alice", city: "northville" }).map(
      (record) => record.key,
    ),
    [3801],
  );
  assert.deepEqual(
    listContactsMatching({ name: "%", address: "_" }),
    [],
  );
  assert.deepEqual(
    listContactsMatching({ name: "   " }).map((record) => record.key),
    listContactsMatching().map((record) => record.key),
  );
});

test("application lists contacts by social media platform without duplicates", () => {
  insertContact(contact(3901));
  insertContact(contact(3902));
  insertContact(contact(3903));
  insertContactSocial({
    ...social(3904, 3901),
    media: "Instagram",
    userid: "alice",
  });
  insertContactSocial({
    ...social(3905, 3901),
    media: "instagram",
    userid: "alice-work",
  });
  insertContactSocial({
    ...social(3906, 3902),
    media: "Instagram",
    userid: "bob",
  });
  insertContactSocial({
    ...social(3907, 3903),
    media: "Mastodon",
    userid: "carol",
  });

  assert.deepEqual(
    listContactsBySocialMedia("Instagram").map((record) => record.key),
    [3901, 3902],
  );
  assert.deepEqual(
    listContactsBySocialMedia("  instagram  ").map((record) => record.key),
    [3901, 3902],
  );
  assert.deepEqual(listContactsBySocialMedia("LinkedIn"), []);
  assert.throws(() => listContactsBySocialMedia("   "), /must not be empty/);
});

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

test("notes require content while parent assignments are optional", () => {
  const person = insertContact(contact(7001));
  const secondPerson = insertContact(contact(7013));
  const calendarEvent = insertEvent(event(7002));
  const secondEvent = insertEvent(event(7014));

  const eventNote = insertNote({
    key: 7003,
    heading: "Event note",
    text: "Details for the event.",
  });
  const contactNote = insertNote({
    key: 7004,
    heading: "Contact note",
    text: "Details for the contact.",
  });
  const sharedNote = insertNote({
    key: 7005,
    heading: "Shared note",
    text: "Details for both.",
  });
  const standaloneNote = insertNote({
    key: 7012,
    heading: "Standalone note",
    text: "Not linked to an event or contact.",
  });

  assert.equal(eventNote.version, 1);
  assert.match(
    eventNote.created_at,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  );
  assert.throws(
    () =>
      db.prepare(
        `INSERT INTO note ("key", "heading", "text")
         VALUES (?, ?, ?)`,
      ).run(7015, "No timestamp", "Timestamp is required"),
    { code: "SQLITE_CONSTRAINT_NOTNULL" },
  );
  assert.deepEqual(listEventsForNote(eventNote.key), []);
  assert.deepEqual(listContactsForNote(contactNote.key), []);
  assert.deepEqual(listEventsForNote(standaloneNote.key), []);
  assert.deepEqual(listContactsForNote(standaloneNote.key), []);

  let version = eventNote.version;
  const linkedFirstEvent = linkNoteToEvent(
    eventNote.key,
    version,
    calendarEvent.key,
  );
  assert.equal(linkedFirstEvent.status, "updated");
  version = linkedFirstEvent.record.version;
  const linkedSecondEvent = linkNoteToEvent(
    eventNote.key,
    version,
    secondEvent.key,
  );
  assert.equal(linkedSecondEvent.status, "updated");
  version = linkedSecondEvent.record.version;
  assert.deepEqual(listEventsForNote(eventNote.key), [
    calendarEvent.key,
    secondEvent.key,
  ]);
  assert.deepEqual(
    linkNoteToEvent(eventNote.key, version, secondEvent.key),
    { status: "unchanged", record: linkedSecondEvent.record },
  );

  const linkedFirstContact = linkNoteToContact(
    sharedNote.key,
    sharedNote.version,
    person.key,
  );
  assert.equal(linkedFirstContact.status, "updated");
  const linkedSecondContact = linkNoteToContact(
    sharedNote.key,
    linkedFirstContact.record.version,
    secondPerson.key,
  );
  assert.equal(linkedSecondContact.status, "updated");
  const linkedFirstSharedEvent = linkNoteToEvent(
    sharedNote.key,
    linkedSecondContact.record.version,
    calendarEvent.key,
  );
  assert.equal(linkedFirstSharedEvent.status, "updated");
  const linkedSecondSharedEvent = linkNoteToEvent(
    sharedNote.key,
    linkedFirstSharedEvent.record.version,
    secondEvent.key,
  );
  assert.equal(linkedSecondSharedEvent.status, "updated");
  assert.deepEqual(listContactsForNote(sharedNote.key), [
    person.key,
    secondPerson.key,
  ]);
  assert.deepEqual(listEventsForNote(sharedNote.key), [
    calendarEvent.key,
    secondEvent.key,
  ]);
  assert.deepEqual(
    listNotesForContact(person.key).map((note) => note.key),
    [sharedNote.key],
  );
  assert.deepEqual(
    listNotesForEvent(calendarEvent.key).map((note) => note.key),
    [sharedNote.key, eventNote.key],
  );
  assert.deepEqual(
    linkNoteToContact(-1, 1, person.key),
    { status: "not_found" },
  );
  assert.deepEqual(
    linkNoteToContact(sharedNote.key, sharedNote.version, -1),
    { status: "conflict", currentVersion: linkedSecondSharedEvent.record.version },
  );
  assert.throws(
    () => linkNoteToContact(sharedNote.key, linkedSecondSharedEvent.record.version, -1),
    { code: "SQLITE_CONSTRAINT_FOREIGNKEY" },
  );
  const unlinked = unlinkNoteFromContact(
    sharedNote.key,
    linkedSecondSharedEvent.record.version,
    secondPerson.key,
  );
  assert.equal(unlinked.status, "updated");
  const stillLinked = unlinkNoteFromEvent(
    sharedNote.key,
    unlinked.record.version,
    calendarEvent.key,
  );
  assert.equal(stillLinked.status, "updated");
  assert.deepEqual(listContactsForNote(sharedNote.key), [person.key]);
  assert.deepEqual(listEventsForNote(sharedNote.key), [secondEvent.key]);
  const removedLastEvent = unlinkNoteFromEvent(
    sharedNote.key,
    stillLinked.record.version,
    secondEvent.key,
  );
  assert.equal(removedLastEvent.status, "updated");
  assert.deepEqual(listEventsForNote(sharedNote.key), []);
  const removedLastContact = unlinkNoteFromContact(
    sharedNote.key,
    removedLastEvent.record.version,
    person.key,
  );
  assert.equal(removedLastContact.status, "updated");
  assert.deepEqual(listContactsForNote(sharedNote.key), []);
  const deletedSharedNote = deleteNote(
    sharedNote.key,
    removedLastContact.record.version,
  );
  assert.equal(deletedSharedNote.status, "deleted");

  assert.throws(
    () =>
      insertNote({
        key: 7006,
        heading: " \t\n ",
        text: "Has a body",
      }),
    /heading must not be empty/,
  );
  assert.throws(
    () =>
      insertNote({
        key: 7007,
        heading: "Has a heading",
        text: " \t\n ",
      }),
    /text must not be empty/,
  );
  const missingParentNote = insertNote({
    key: 7009,
    heading: "Missing event",
    text: "Invalid reference",
  });
  assert.throws(
    () => linkNoteToEvent(missingParentNote.key, missingParentNote.version, -1),
    { code: "SQLITE_CONSTRAINT_FOREIGNKEY" },
  );
  assert.throws(
    () =>
      db.prepare(
        `INSERT INTO note ("key", "created_at", "heading", "text")
         VALUES (?, ?, ?, ?)`,
      ).run(7010, "2026-03-01T00:00:00.000Z", "Blank", " \t\n "),
    { code: "SQLITE_CONSTRAINT_CHECK" },
  );
  assert.doesNotThrow(() =>
    db.prepare(
      `INSERT INTO note ("key", "created_at", "heading", "text")
       VALUES (?, ?, ?, ?)`,
    ).run(
      7011,
      "2026-03-01T00:00:00.000Z",
      "Standalone SQL note",
      "No parent assignment",
    ),
  );
});

test("notes use optimistic locking and survive deletion of linked parents", () => {
  const person = insertContact(contact(7101));
  const calendarEvent = insertEvent(event(7102));
  const note = insertNote({
    key: 7103,
    heading: "Keep this note",
    text: "The note outlives its linked records.",
  });
  const contactLink = linkNoteToContact(note.key, note.version, person.key);
  assert.equal(contactLink.status, "updated");
  const eventLink = linkNoteToEvent(
    note.key,
    contactLink.record.version,
    calendarEvent.key,
  );
  assert.equal(eventLink.status, "updated");
  const linkedNote = eventLink.record;

  assert.deepEqual(deleteContact(person.key, person.version + 1), {
    status: "conflict",
    currentVersion: person.version,
  });
  assert.equal(
    db.prepare('SELECT "version" FROM note WHERE "key" = ?').get(note.key)
      .version,
    linkedNote.version,
  );

  const update = updateNote(note.key, linkedNote.version, {
    heading: "Updated heading",
  });
  assert.equal(update.status, "updated");
  assert.equal(update.record.version, linkedNote.version + 1);
  assert.deepEqual(updateNote(note.key, linkedNote.version, { text: "Stale edit" }), {
    status: "conflict",
    currentVersion: update.record.version,
  });
  assert.throws(
    () => updateNote(note.key, update.record.version, { text: " \t " }),
    /text must not be empty/,
  );
  assert.equal(deleteContact(person.key, person.version).status, "deleted");
  const afterContactDelete = db
    .prepare('SELECT * FROM note WHERE "key" = ?')
    .get(note.key);
  assert.ok(afterContactDelete);
  assert.equal(afterContactDelete.version, update.record.version + 1);
  assert.deepEqual(listContactsForNote(note.key), []);
  assert.deepEqual(listEventsForNote(note.key), [calendarEvent.key]);
  assert.equal(countRows("event", "key", calendarEvent.key), 1);

  assert.equal(
    deleteEvent(calendarEvent.key, calendarEvent.version).status,
    "deleted",
  );
  const afterBothParentsDelete = db
    .prepare('SELECT * FROM note WHERE "key" = ?')
    .get(note.key);
  assert.ok(afterBothParentsDelete);
  assert.deepEqual(listContactsForNote(note.key), []);
  assert.deepEqual(listEventsForNote(note.key), []);
  assert.equal(afterBothParentsDelete.version, afterContactDelete.version + 1);

  const orphanUpdate = updateNote(note.key, afterBothParentsDelete.version, {
    text: "Still editable after deleting both parents.",
  });
  assert.equal(orphanUpdate.status, "updated");
  assert.equal(orphanUpdate.record.version, afterBothParentsDelete.version + 1);

  assert.deepEqual(deleteNote(note.key, afterBothParentsDelete.version), {
    status: "conflict",
    currentVersion: orphanUpdate.record.version,
  });
  const deleted = deleteNote(note.key, orphanUpdate.record.version);
  assert.equal(deleted.status, "deleted");
  assert.equal(deleted.record.key, note.key);
  assert.deepEqual(deleteNote(note.key, orphanUpdate.record.version), {
    status: "not_found",
  });
});

test("application creates standalone or assigned notes atomically", () => {
  const person = insertContact(contact(7201));
  const calendarEvent = insertEvent(event(7202));

  const standalone = createNoteApplication({
    key: 7203,
    heading: "Standalone",
    text: "No assignments are required.",
  });
  assert.equal(standalone.status, "created");
  assert.equal(standalone.note.version, 1);
  assert.match(
    standalone.note.created_at,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  );
  assert.ok(Number.isFinite(Date.parse(standalone.note.created_at)));
  assert.ok(Math.abs(Date.now() - Date.parse(standalone.note.created_at)) < 5000);
  assert.deepEqual(standalone.contactKeys, []);
  assert.deepEqual(standalone.eventKeys, []);

  const assigned = createNoteApplication({
    key: 7204,
    heading: "Assigned",
    text: "Linked on creation.",
    contactKeys: [person.key],
    eventKeys: [calendarEvent.key],
  });
  assert.equal(assigned.status, "created");
  assert.equal(assigned.note.version, 3);
  assert.deepEqual(assigned.contactKeys, [person.key]);
  assert.deepEqual(assigned.eventKeys, [calendarEvent.key]);

  assert.deepEqual(
    createNoteApplication({
      key: 7205,
      heading: "Bad contact",
      text: "Missing parent",
      contactKeys: [-1],
    }),
    { status: "contact_not_found", contactKey: -1 },
  );
  assert.equal(countRows("note", "key", 7205), 0);
  assert.deepEqual(
    createNoteApplication({
      key: 7206,
      heading: "Duplicate contact",
      text: "Repeated assignment",
      contactKeys: [person.key, person.key],
    }),
    { status: "duplicate_contact", contactKey: person.key },
  );
  assert.equal(countRows("note", "key", 7206), 0);
});

test("application updates note content and replaces assignments with optimistic locking", () => {
  const firstContact = insertContact(contact(7301));
  const secondContact = insertContact(contact(7302));
  const firstEvent = insertEvent(event(7303));
  const secondEvent = insertEvent(event(7304));
  const created = createNoteApplication({
    key: 7305,
    heading: "Before update",
    text: "Initial content",
    contactKeys: [firstContact.key],
    eventKeys: [firstEvent.key],
  });
  assert.equal(created.status, "created");

  assert.deepEqual(
    updateNoteWithAssignments({
      noteKey: 7305,
      expectedVersion: 1,
      changes: { heading: "Stale" },
    }),
    { status: "note_conflict", currentVersion: created.note.version },
  );
  assert.deepEqual(
    updateNoteWithAssignments({
      noteKey: 7305,
      expectedVersion: created.note.version,
      changes: { heading: "Must not apply" },
      contactKeys: [-1],
    }),
    { status: "contact_not_found", contactKey: -1 },
  );
  assert.equal(
    db.prepare('SELECT "heading" FROM note WHERE "key" = ?').get(7305).heading,
    "Before update",
  );

  const updated = updateNoteWithAssignments({
    noteKey: 7305,
    expectedVersion: created.note.version,
    changes: { heading: "After update", text: "Changed content" },
    contactKeys: [secondContact.key],
    eventKeys: [secondEvent.key],
  });
  assert.equal(updated.status, "updated");
  assert.equal(updated.note.heading, "After update");
  assert.equal(updated.note.version, created.note.version + 5);
  assert.deepEqual(updated.contactKeys, [secondContact.key]);
  assert.deepEqual(updated.eventKeys, [secondEvent.key]);

  const removedAssignments = updateNoteWithAssignments({
    noteKey: 7305,
    expectedVersion: updated.note.version,
    changes: {},
    contactKeys: [],
    eventKeys: [],
  });
  assert.equal(removedAssignments.status, "updated");
  assert.deepEqual(removedAssignments.contactKeys, []);
  assert.deepEqual(removedAssignments.eventKeys, []);
  assert.equal(removedAssignments.note.version, updated.note.version + 2);
});

test("application deletes notes without deleting assigned parents", () => {
  const person = insertContact(contact(7401));
  const calendarEvent = insertEvent(event(7402));
  const created = createNoteApplication({
    key: 7403,
    heading: "Delete note",
    text: "Parents remain.",
    contactKeys: [person.key],
    eventKeys: [calendarEvent.key],
  });
  assert.equal(created.status, "created");

  assert.deepEqual(deleteNoteWithAssignments(7403, 1), {
    status: "conflict",
    currentVersion: created.note.version,
  });
  assert.equal(
    deleteNoteWithAssignments(7403, created.note.version).status,
    "deleted",
  );
  assert.equal(countRows("note_contacts", "note_key", 7403), 0);
  assert.equal(countRows("note_events", "note_key", 7403), 0);
  assert.equal(countRows("contact", "key", person.key), 1);
  assert.equal(countRows("event", "key", calendarEvent.key), 1);
});

test("application note listings cover text, date, and assignment filters", () => {
  const firstContact = insertContact(contact(7501));
  const secondContact = insertContact(contact(7502));
  const firstEvent = insertEvent(event(7503));
  const secondEvent = insertEvent(event(7504));

  const oldStandalone = insertNote({
    key: 7505,
    created_at: "2026-01-01T10:00:00.000Z",
    heading: "Old standalone",
    text: "An older note.",
  });
  const shared = insertNote({
    key: 7506,
    created_at: "2026-01-02T10:00:00.000Z",
    heading: "Project plan",
    text: "Discuss schedule.",
  });
  const contactOnly = insertNote({
    key: 7507,
    created_at: "2026-01-03T10:00:00.000Z",
    heading: "Contact update",
    text: "Call tomorrow.",
  });
  const eventOnly = insertNote({
    key: 7508,
    created_at: "2026-01-04T10:00:00.000Z",
    heading: "Event agenda",
    text: "Project review.",
  });
  const anotherContactEvent = insertNote({
    key: 7509,
    created_at: "2026-01-05T10:00:00.000Z",
    heading: "Other pair",
    text: "For another event.",
  });

  const sharedContactLink = linkNoteToContact(
    shared.key,
    shared.version,
    firstContact.key,
  );
  assert.equal(sharedContactLink.status, "updated");
  assert.equal(
    linkNoteToEvent(
      shared.key,
      sharedContactLink.record.version,
      firstEvent.key,
    ).status,
    "updated",
  );
  assert.equal(
    linkNoteToContact(contactOnly.key, contactOnly.version, firstContact.key)
      .status,
    "updated",
  );
  assert.equal(
    linkNoteToEvent(eventOnly.key, eventOnly.version, firstEvent.key).status,
    "updated",
  );
  const otherContactLink = linkNoteToContact(
    anotherContactEvent.key,
    anotherContactEvent.version,
    firstContact.key,
  );
  assert.equal(otherContactLink.status, "updated");
  const otherEventLink = linkNoteToEvent(
    anotherContactEvent.key,
    otherContactLink.record.version,
    secondEvent.key,
  );
  assert.equal(otherEventLink.status, "updated");
  assert.equal(
    linkNoteToContact(
      anotherContactEvent.key,
      otherEventLink.record.version,
      secondContact.key,
    ).status,
    "updated",
  );

  assert.deepEqual(
    listAllNotes()
      .filter((note) => note.key >= 7505 && note.key <= 7509)
      .map((note) => note.key),
    [7509, 7508, 7507, 7506, 7505],
  );
  assert.deepEqual(
    searchNotes("PROJECT")
      .filter((note) => note.key >= 7505 && note.key <= 7509)
      .map((note) => note.key),
    [7508, 7506],
  );
  assert.deepEqual(
    searchNotes("%").filter((note) => note.key >= 7505 && note.key <= 7509),
    [],
  );
  assert.deepEqual(searchNotes("  "), []);
  assert.deepEqual(
    listNotesCreatedInRange(
      "2026-01-02T10:00:00.000Z",
      "2026-01-04T10:00:00.000Z",
    ).map((note) => note.key),
    [7507, 7506],
  );
  assert.deepEqual(
    listUnassignedNotes()
      .filter((note) => note.key >= 7505 && note.key <= 7509)
      .map((note) => note.key),
    [7505],
  );
  assert.deepEqual(
    listNotesForContactKey(firstContact.key)
      .filter((note) => note.key >= 7505 && note.key <= 7509)
      .map((note) => note.key),
    [7509, 7507, 7506],
  );
  assert.deepEqual(
    listNotesForEventKey(firstEvent.key)
      .filter((note) => note.key >= 7505 && note.key <= 7509)
      .map((note) => note.key),
    [7508, 7506],
  );
  assert.deepEqual(
    listNotesForContactAndEvent(firstContact.key, firstEvent.key).map(
      (note) => note.key,
    ),
    [7506],
  );
  assert.deepEqual(
    listNotesForContactAndEvent(secondContact.key, secondEvent.key).map(
      (note) => note.key,
    ),
    [7509],
  );

  assert.throws(
    () =>
      listNotesCreatedInRange(
        "2026-01-04T10:00:00.000Z",
        "2026-01-01T10:00:00.000Z",
      ),
    /Note range end must be later/,
  );
});

test("note-link migration preserves existing note contents and assignments", () => {
  const legacyDatabasePath = join(temporaryDirectory, "legacy-notes.db");
  const legacyDatabase = new Database(legacyDatabasePath);
  legacyDatabase.pragma("foreign_keys = ON");
  legacyDatabase.exec(`
    CREATE TABLE contact ("key" INTEGER PRIMARY KEY);
    CREATE TABLE event ("key" INTEGER PRIMARY KEY);
    INSERT INTO contact ("key") VALUES (1), (2);
    INSERT INTO event ("key") VALUES (3), (4);
  `);
  legacyDatabase.exec(
    readFileSync(
      new URL("../database/migrations/003_add_notes.sql", import.meta.url),
      "utf8",
    ),
  );
  legacyDatabase
    .prepare(
      `INSERT INTO note ("key", "heading", "text", "event_key", "contact_key")
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(5, "Preserved heading", "Preserved text", 3, 1);
  legacyDatabase
    .prepare(
      `INSERT INTO note ("key", "heading", "text", "contact_key")
       VALUES (?, ?, ?, ?)`,
    )
    .run(6, "Contact-only heading", "Contact-only text", 2);

  legacyDatabase.exec(
    readFileSync(
      new URL("../database/migrations/004_normalize_note_links.sql", import.meta.url),
      "utf8",
    ),
  );

  assert.deepEqual(
    legacyDatabase
      .prepare('SELECT "key", "heading", "text" FROM note ORDER BY "key"')
      .all(),
    [
      { key: 5, heading: "Preserved heading", text: "Preserved text" },
      { key: 6, heading: "Contact-only heading", text: "Contact-only text" },
    ],
  );
  assert.deepEqual(
    legacyDatabase
      .prepare('SELECT "note_key", "contact_key" FROM note_contacts ORDER BY "note_key"')
      .all(),
    [
      { note_key: 5, contact_key: 1 },
      { note_key: 6, contact_key: 2 },
    ],
  );
  assert.deepEqual(
    legacyDatabase
      .prepare('SELECT "note_key", "event_key" FROM note_events ORDER BY "note_key"')
      .all(),
    [{ note_key: 5, event_key: 3 }],
  );

  const legacyTimestamps = legacyDatabase
    .prepare('SELECT "key", "created_at" FROM note ORDER BY "key"')
    .all();
  legacyDatabase.pragma("foreign_keys = OFF");
  legacyDatabase.exec(
    readFileSync(
      new URL(
        "../database/migrations/005_note_created_at_iso8601.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  legacyDatabase.pragma("foreign_keys = ON");

  const migratedTimestamps = legacyDatabase
    .prepare('SELECT "key", "created_at" FROM note ORDER BY "key"')
    .all();
  assert.deepEqual(
    migratedTimestamps.map((row) => row.key),
    legacyTimestamps.map((row) => row.key),
  );
  assert.deepEqual(
    migratedTimestamps.map((row) => row.created_at),
    legacyTimestamps.map((row) => `${row.created_at.replace(" ", "T")}.000Z`),
  );
  assert.ok(
    migratedTimestamps.every((row) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
        row.created_at,
      ),
    ),
  );
  assert.equal(
    legacyDatabase
      .pragma("table_info('note')")
      .find((column) => column.name === "created_at").dflt_value,
    null,
  );
  assert.equal(
    legacyDatabase
      .prepare("SELECT count(*) AS count FROM note_contacts")
      .get().count,
    2,
  );
  assert.equal(
    legacyDatabase
      .prepare("SELECT count(*) AS count FROM note_events")
      .get().count,
    1,
  );
  assert.deepEqual(legacyDatabase.pragma("foreign_key_check"), []);
  legacyDatabase.close();
});
