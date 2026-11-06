import { test } from "node:test";
import {
  assert,
  contact,
  countRows,
  createNoteApplication,
  Database,
  db,
  deleteContact,
  deleteEvent,
  deleteNote,
  deleteNoteWithAssignments,
  event,
  insertContact,
  insertEvent,
  insertNote,
  join,
  linkNoteToContact,
  linkNoteToEvent,
  listAllNotes,
  listContactsForNote,
  listEventsForNote,
  listNotesCreatedInRange,
  listNotesForContact,
  listNotesForContactAndEvent,
  listNotesForContactKey,
  listNotesForEvent,
  listNotesForEventKey,
  listUnassignedNotes,
  readFileSync,
  searchNotes,
  temporaryDirectory,
  unlinkNoteFromContact,
  unlinkNoteFromEvent,
  updateNote,
  updateNoteWithAssignments,
} from "./test-fixtures.mjs";

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
