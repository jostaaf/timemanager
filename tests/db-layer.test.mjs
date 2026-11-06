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
const { insertNote, updateNote, deleteNote } = await import(
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
    start: "2026-01-01",
    end: "2026-01-02",
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
  assert.match(eventNote.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
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
    [eventNote.key, sharedNote.key],
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
        `INSERT INTO note ("key", "heading", "text")
         VALUES (?, ?, ?)`,
      ).run(7010, "Blank", " \t\n "),
    { code: "SQLITE_CONSTRAINT_CHECK" },
  );
  assert.doesNotThrow(() =>
    db.prepare(
      `INSERT INTO note ("key", "heading", "text")
       VALUES (?, ?, ?)`,
    ).run(7011, "Standalone SQL note", "No parent assignment"),
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
  assert.deepEqual(legacyDatabase.pragma("foreign_key_check"), []);
  legacyDatabase.close();
});
