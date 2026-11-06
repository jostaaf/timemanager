import { test } from "node:test";
import {
  assert,
  insertContact,
  updateContact,
  deleteContact,
  insertContactSocial,
  updateContactSocial,
  deleteContactSocial,
  insertEvent,
  updateEvent,
  deleteEvent,
  insertEventContact,
  updateEventContact,
  deleteEventContact,
  contact,
  social,
  event,
  eventContact,
} from "./test-fixtures.mjs";

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
