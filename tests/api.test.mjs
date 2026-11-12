import { test } from "node:test";
import { assert, db, startApiServer } from "./test-fixtures.mjs";

test("contacts HTTP API validates, authenticates, and delegates contact operations", async () => {
  const token = "test-api-token-0123456789-abcdefghijkl";
  const server = await startApiServer(token);

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  assert.equal(address.address, "127.0.0.1");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const authorizedFetch = (path, options = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...options.headers,
      },
    });

  try {
    const unauthorized = await fetch(`${baseUrl}/api/contacts`);
    assert.equal(unauthorized.status, 401);

    const invalid = await authorizedFetch("/api/contacts", {
      method: "POST",
      body: JSON.stringify({ contact: { name: "Incomplete" } }),
    });
    assert.equal(invalid.status, 400);

    const malformedJson = await authorizedFetch("/api/contacts", {
      method: "POST",
      body: "{",
    });
    assert.equal(malformedJson.status, 400);

    const contactCountBeforeCreate = db
      .prepare("SELECT count(*) AS count FROM contact")
      .get().count;
    const contactPayload = {
      contact: {
        name: "API Contact",
        street: "1 API Lane",
        zip: "12345",
        city: "Api City",
        phone: null,
        email: null,
        tag: null,
        comment: null,
      },
      socials: [{
        media: "example",
        userid: "api-user",
        comment: null,
      }],
    };
    const createdResponse = await authorizedFetch("/api/contacts", {
      method: "POST",
      body: JSON.stringify(contactPayload),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.ok(created.contact.key > 0);
    assert.equal(created.contact.version, 1);
    assert.equal(created.socials.length, 1);
    assert.equal(created.socials[0].contact_key, created.contact.key);
    assert.equal(created.socials[0].version, 1);
    assert.equal(
      db.prepare("SELECT count(*) AS count FROM contact").get().count,
      contactCountBeforeCreate + 1,
    );

    const detailResponse = await authorizedFetch(
      `/api/contacts/${created.contact.key}`,
    );
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json();
    assert.equal(detail.contact.name, "API Contact");
    assert.equal(detail.socials[0].media, "example");

    const missingDetail = await authorizedFetch("/api/contacts/999999999");
    assert.equal(missingDetail.status, 404);

    const listedResponse = await authorizedFetch("/api/contacts?city=Api%20City");
    assert.equal(listedResponse.status, 200);
    const listed = await listedResponse.json();
    assert.equal(listed.contacts.length, 1);
    assert.equal(listed.contacts[0].contact.name, "API Contact");
    assert.equal(listed.contacts[0].socials[0].userid, "api-user");

    const updatedResponse = await authorizedFetch(
      `/api/contacts/${created.contact.key}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: 1,
          changes: {
            name: "Updated API Contact",
            street: "2 API Lane",
          },
          socialChanges: [{
            type: "update",
            key: created.socials[0].key,
            expectedVersion: 1,
            changes: { userid: "updated-user" },
          }, {
            type: "add",
            record: {
              media: "second-example",
              userid: null,
              comment: null,
            },
          }],
        }),
      },
    );
    assert.equal(updatedResponse.status, 200);
    const updated = await updatedResponse.json();
    assert.equal(updated.contact.version, 2);
    assert.equal(updated.contact.name, "Updated API Contact");
    assert.equal(updated.contact.street, "2 API Lane");
    assert.equal(updated.socials[0].version, 2);
    assert.equal(updated.socials[0].userid, "updated-user");
    assert.equal(updated.socials.length, 2);

    const addedSocial = updated.socials.find(
      (social) => social.media === "second-example",
    );
    const socialDeletedResponse = await authorizedFetch(
      `/api/contacts/${created.contact.key}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: 2,
          changes: {},
          socialChanges: [{
            type: "delete",
            key: addedSocial.key,
            expectedVersion: 1,
          }],
        }),
      },
    );
    assert.equal(socialDeletedResponse.status, 200);
    const socialDeleted = await socialDeletedResponse.json();
    assert.equal(socialDeleted.contact.version, 2);
    assert.equal(socialDeleted.socials.length, 1);

    const conflictResponse = await authorizedFetch(
      `/api/contacts/${created.contact.key}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: 1,
          changes: { name: "Stale update" },
          socialChanges: [],
        }),
      },
    );
    assert.equal(conflictResponse.status, 409);

    const deletedResponse = await authorizedFetch(
      `/api/contacts/${created.contact.key}`,
      {
        method: "DELETE",
        body: JSON.stringify({ expectedVersion: 2 }),
      },
    );
    assert.equal(deletedResponse.status, 200);
    assert.equal((await deletedResponse.json()).status, "deleted");

    const missingResponse = await authorizedFetch(
      `/api/contacts/${created.contact.key}`,
      {
        method: "DELETE",
        body: JSON.stringify({ expectedVersion: 2 }),
      },
    );
    assert.equal(missingResponse.status, 404);

    const legacyContact = db.prepare(
      `INSERT INTO contact
        ("version", "name", "street", "zip", "city", "phone", "email", "tag", "comment")
       VALUES (0, 'Legacy API Contact', 'Old Street', '54321', 'Legacy City', NULL, NULL, NULL, NULL)
       RETURNING "key", "version"`,
    ).get();
    assert.ok(legacyContact);
    const legacyDetailResponse = await authorizedFetch(
      `/api/contacts/${legacyContact.key}`,
    );
    assert.equal(legacyDetailResponse.status, 200);
    const legacyDetail = await legacyDetailResponse.json();
    assert.equal(legacyDetail.contact.version, 0);

    const legacyUpdateResponse = await authorizedFetch(
      `/api/contacts/${legacyContact.key}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: 0,
          changes: { street: "Updated Legacy Street" },
          socialChanges: [],
        }),
      },
    );
    assert.equal(legacyUpdateResponse.status, 200);
    const legacyUpdate = await legacyUpdateResponse.json();
    assert.equal(legacyUpdate.contact.street, "Updated Legacy Street");
    assert.equal(legacyUpdate.contact.version, 1);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("events HTTP API manages events and their contact assignments", async () => {
  const token = "test-events-api-token-0123456789-abcdefgh";
  const server = await startApiServer(token);
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const authorizedFetch = (path, options = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...options.headers,
      },
    });

  try {
    const contact = db.prepare(
      `INSERT INTO contact
        ("version", "name", "street", "zip", "city", "phone", "email", "tag", "comment")
       VALUES (1, 'Event API Contact', '1 Test Lane', '12345', 'Test City', NULL, NULL, NULL, NULL)
       RETURNING "key"`,
    ).get();
    const secondContact = db.prepare(
      `INSERT INTO contact
        ("version", "name", "street", "zip", "city", "phone", "email", "tag", "comment")
       VALUES (1, 'Second Event Contact', '2 Test Lane', '12345', 'Test City', NULL, NULL, NULL, NULL)
       RETURNING "key"`,
    ).get();
    const payload = {
      event: {
        name: "API Event",
        start: "2026-11-12T09:00:00.000Z",
        end: "2026-11-12T10:00:00.000Z",
        comment: null,
      },
      contacts: [{ contactKey: contact.key, role: "host" }],
    };
    const createdResponse = await authorizedFetch("/api/events", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const created = await createdResponse.json();
    assert.equal(createdResponse.status, 201, JSON.stringify(created));
    assert.ok(created.event.key > 0);
    assert.equal(created.event.version, 1);
    assert.equal(created.contacts.length, 1);
    assert.equal(created.contacts[0].contact.name, "Event API Contact");
    assert.equal(created.contacts[0].role, "host");

    const listedResponse = await authorizedFetch("/api/events?name=API");
    assert.equal(listedResponse.status, 200);
    assert.equal((await listedResponse.json()).events[0].key, created.event.key);
    const detailResponse = await authorizedFetch(
      `/api/events/${created.event.key}`,
    );
    assert.equal(detailResponse.status, 200);
    assert.equal((await detailResponse.json()).contacts.length, 1);

    const updatedResponse = await authorizedFetch(
      `/api/events/${created.event.key}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: 1,
          changes: { name: "Updated API Event" },
          contactChanges: [{
            type: "update",
            key: created.contacts[0].key,
            expectedVersion: 1,
            changes: { role: "organizer" },
          }],
        }),
      },
    );
    assert.equal(updatedResponse.status, 200);
    const updated = await updatedResponse.json();
    assert.equal(updated.event.version, 2);
    assert.equal(updated.event.name, "Updated API Event");
    assert.equal(updated.contacts[0].version, 2);
    assert.equal(updated.contacts[0].role, "organizer");

    const invalidUpdate = await authorizedFetch(
      `/api/events/${created.event.key}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: 2,
          changes: { end: "2026-11-12T08:00:00.000Z" },
          contactChanges: [],
        }),
      },
    );
    assert.equal(invalidUpdate.status, 400);

    const reassignedResponse = await authorizedFetch(
      `/api/events/${created.event.key}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: 2,
          changes: {},
          contactChanges: [{
            type: "delete",
            key: updated.contacts[0].key,
            expectedVersion: 2,
          }, {
            type: "add",
            contactKey: secondContact.key,
            role: "attendee",
          }],
        }),
      },
    );
    assert.equal(reassignedResponse.status, 200);
    const reassigned = await reassignedResponse.json();
    assert.equal(reassigned.contacts.length, 1);
    assert.equal(reassigned.contacts[0].contact.name, "Second Event Contact");
    assert.equal(reassigned.contacts[0].role, "attendee");

    const conflictResponse = await authorizedFetch(
      `/api/events/${created.event.key}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: 1,
          changes: { name: "Stale event" },
          contactChanges: [],
        }),
      },
    );
    assert.equal(conflictResponse.status, 409);

    const deletedResponse = await authorizedFetch(
      `/api/events/${created.event.key}`,
      {
        method: "DELETE",
        body: JSON.stringify({ expectedVersion: 2 }),
      },
    );
    assert.equal(deletedResponse.status, 200);
    assert.equal((await deletedResponse.json()).status, "deleted");

    const invalidTimestamp = await authorizedFetch("/api/events", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        event: { ...payload.event, start: "not-a-timestamp" },
      }),
    });
    assert.equal(invalidTimestamp.status, 400);

    const invalidRange = await authorizedFetch("/api/events", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        event: {
          ...payload.event,
          start: "2026-11-12T10:00:00.000Z",
          end: "2026-11-12T09:00:00.000Z",
        },
      }),
    });
    assert.equal(invalidRange.status, 400);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("notes HTTP API manages note content and contact/event assignments", async () => {
  const token = "test-notes-api-token-0123456789-abcdefgh";
  const server = await startApiServer(token);
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const authorizedFetch = (path, options = {}) =>
    fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...options.headers,
      },
    });

  try {
    const contact = db.prepare(
      `INSERT INTO contact
        ("version", "name", "street", "zip", "city", "phone", "email", "tag", "comment")
       VALUES (1, 'Note API Contact', '1 Test Lane', '12345', 'Test City', NULL, NULL, NULL, NULL)
       RETURNING "key"`,
    ).get();
    const secondContact = db.prepare(
      `INSERT INTO contact
        ("version", "name", "street", "zip", "city", "phone", "email", "tag", "comment")
       VALUES (1, 'Second Note Contact', '2 Test Lane', '12345', 'Test City', NULL, NULL, NULL, NULL)
       RETURNING "key"`,
    ).get();
    const event = db.prepare(
      `INSERT INTO event
        ("version", "name", "start", "end", "comment")
       VALUES (1, 'Note API Event', '2026-11-12T09:00:00.000Z', '2026-11-12T10:00:00.000Z', NULL)
       RETURNING "key"`,
    ).get();
    const secondEvent = db.prepare(
      `INSERT INTO event
        ("version", "name", "start", "end", "comment")
       VALUES (1, 'Second Note Event', '2026-11-13T09:00:00.000Z', '2026-11-13T10:00:00.000Z', NULL)
       RETURNING "key"`,
    ).get();

    const createdResponse = await authorizedFetch("/api/notes", {
      method: "POST",
      body: JSON.stringify({
        heading: "API note",
        text: "A note body for searching",
        contactKeys: [contact.key],
        eventKeys: [event.key],
      }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.ok(created.note.key > 0);
    assert.equal(created.note.version, 3);
    assert.equal(created.contacts[0].name, "Note API Contact");
    assert.equal(created.events[0].name, "Note API Event");

    const eventNotesResponse = await authorizedFetch(
      `/api/notes?eventKey=${event.key}`,
    );
    assert.equal(eventNotesResponse.status, 200);
    assert.ok(
      (await eventNotesResponse.json()).notes.some(
        (note) => note.key === created.note.key,
      ),
    );

    const listedResponse = await authorizedFetch("/api/notes?q=searching");
    assert.equal(listedResponse.status, 200);
    assert.equal((await listedResponse.json()).notes[0].key, created.note.key);
    const detailResponse = await authorizedFetch(
      `/api/notes/${created.note.key}`,
    );
    assert.equal(detailResponse.status, 200);
    assert.equal((await detailResponse.json()).note.heading, "API note");

    const updatedResponse = await authorizedFetch(
      `/api/notes/${created.note.key}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: created.note.version,
          changes: { heading: "Updated API note" },
          contactKeys: [secondContact.key],
          eventKeys: [secondEvent.key],
        }),
      },
    );
    assert.equal(updatedResponse.status, 200);
    const updated = await updatedResponse.json();
    assert.equal(updated.note.heading, "Updated API note");
    assert.ok(updated.note.version > created.note.version);
    assert.equal(updated.contacts[0].name, "Second Note Contact");
    assert.equal(updated.events[0].name, "Second Note Event");
    const oldEventNotesResponse = await authorizedFetch(
      `/api/notes?eventKey=${event.key}`,
    );
    assert.ok(
      !(await oldEventNotesResponse.json()).notes.some(
        (note) => note.key === created.note.key,
      ),
    );
    const updatedEventNotesResponse = await authorizedFetch(
      `/api/notes?eventKey=${secondEvent.key}`,
    );
    assert.ok(
      (await updatedEventNotesResponse.json()).notes.some(
        (note) => note.key === created.note.key,
      ),
    );

    const conflictResponse = await authorizedFetch(
      `/api/notes/${created.note.key}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: created.note.version,
          changes: { heading: "Stale note" },
        }),
      },
    );
    assert.equal(conflictResponse.status, 409);

    const deletedResponse = await authorizedFetch(
      `/api/notes/${created.note.key}`,
      {
        method: "DELETE",
        body: JSON.stringify({ expectedVersion: updated.note.version }),
      },
    );
    assert.equal(deletedResponse.status, 200);
    assert.equal((await deletedResponse.json()).status, "deleted");

    const invalidResponse = await authorizedFetch("/api/notes", {
      method: "POST",
      body: JSON.stringify({ heading: " ", text: "Body" }),
    });
    assert.equal(invalidResponse.status, 400);

    const standaloneResponse = await authorizedFetch("/api/notes", {
      method: "POST",
      body: JSON.stringify({
        heading: "Standalone note",
        text: "No contact or event is required",
      }),
    });
    assert.equal(standaloneResponse.status, 201);
    const standalone = await standaloneResponse.json();
    assert.equal(standalone.note.version, 1);
    assert.deepEqual(standalone.contacts, []);
    assert.deepEqual(standalone.events, []);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
