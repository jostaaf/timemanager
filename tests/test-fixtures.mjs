import assert from "node:assert/strict";
import { after } from "node:test";
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
const { listContactsWithSocials } = await import(
  "../dist/server/application/contacts/list-contacts-with-socials.js"
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


export {
  assert, db,
  insertContact, updateContact, deleteContact,
  insertContactSocial, updateContactSocial, deleteContactSocial,
  insertEvent, updateEvent, deleteEvent,
  insertEventContact, updateEventContact, deleteEventContact,
  createContactWithSocials, createEventWithContacts, addContactToEvent,
  createContactApplication, updateContactWithSocials, deleteContactWithSocials,
  listContactsMatching, listContactsWithSocials, listContactsBySocialMedia,
  createEventApplication, updateEventWithContacts, deleteEventWithContacts,
  listAllEvents, listEventsInRange, listUpcomingEvents, searchEventsByName,
  listEventsForContact, listEventsWithContacts, listEventsWithoutContacts,
  createNoteApplication, updateNoteWithAssignments, deleteNoteWithAssignments,
  listAllNotes, searchNotes, listNotesCreatedInRange, listUnassignedNotes,
  listNotesForContactKey, listNotesForEventKey, listNotesForContactAndEvent,
  insertNoteRecord, updateNote, deleteNote,
  linkNoteToContact, unlinkNoteFromContact, listContactsForNote,
  linkNoteToEvent, unlinkNoteFromEvent, listEventsForNote,
  listNotesForContact, listNotesForEvent,
  insertNote, contact, social, event, eventContact, countRows,
  Database, readFileSync, join, temporaryDirectory,
};
