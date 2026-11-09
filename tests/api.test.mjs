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
