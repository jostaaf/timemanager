import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
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
     WHERE type IN ('table', 'index')
       AND sql IS NOT NULL
       AND name NOT LIKE 'sqlite_%'
     ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name`,
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
