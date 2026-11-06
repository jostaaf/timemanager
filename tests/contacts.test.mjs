import { test } from "node:test";
import {
  assert,
  contact,
  countRows,
  createContactApplication,
  createContactWithSocials,
  db,
  deleteContactWithSocials,
  insertContact,
  insertContactSocial,
  listContactsBySocialMedia,
  listContactsMatching,
  listContactsWithSocials,
  social,
  updateContactWithSocials,
} from "./test-fixtures.mjs";

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


test("contact listing combines social filters, includes all socials, and paginates", () => {
  insertContact({
    ...contact(3951),
    name: "Alpha",
    city: "North",
    phone: "555-0101",
    email: "alpha@example.com",
    tag: "friend",
  });
  insertContact({
    ...contact(3952),
    name: "Beta",
    city: "North",
    phone: "555-0102",
    email: "beta@example.com",
    tag: "work",
  });
  insertContact({
    ...contact(3953),
    name: "Gamma",
    city: "South",
    phone: "555-0103",
    email: "gamma@example.com",
    tag: "friend",
  });
  insertContactSocial({
    ...social(3954, 3951),
    media: "Instagram",
    userid: "alpha_handle",
  });
  insertContactSocial({
    ...social(3955, 3951),
    media: "Mastodon",
    userid: "alpha@social.example",
  });
  insertContactSocial({
    ...social(3956, 3952),
    media: "Instagram",
    userid: "beta_handle",
  });
  insertContactSocial({
    ...social(3957, 3953),
    media: "Mastodon",
    userid: "gamma",
  });

  assert.deepEqual(
    listContactsMatching({
      city: "north",
      socialMedia: "INSTAGRAM",
      socialUserId: "handle",
    }).map((record) => record.key),
    [3951, 3952],
  );
  assert.deepEqual(
    listContactsMatching({ socialUserId: "SOCIAL.EXAMPLE" }).map(
      (record) => record.key,
    ),
    [3951],
  );
  assert.deepEqual(
    listContactsMatching({ phone: "0102" }).map((record) => record.key),
    [3952],
  );
  assert.deepEqual(
    listContactsMatching({ email: "GAMMA@" }).map((record) => record.key),
    [3953],
  );
  assert.deepEqual(
    listContactsMatching({ tag: "friend" }).map((record) => record.key),
    [3951, 3953],
  );

  const withSocials = listContactsWithSocials(
    { socialMedia: "instagram", city: "north" },
    { sortBy: "name", sortDirection: "desc", limit: 1 },
  );
  assert.deepEqual(
    withSocials.map(({ contact: record, socials }) => [
      record.key,
      socials.map(({ media }) => media),
    ]),
    [[3952, ["Instagram"]]],
  );
  assert.deepEqual(
    listContactsWithSocials({ name: "alpha" })[0].socials.map(
      ({ media }) => media,
    ),
    ["Instagram", "Mastodon"],
  );

  assert.deepEqual(
    listContactsMatching({}, { sortBy: "city", sortDirection: "desc" })
      .filter((record) => record.key >= 3951 && record.key <= 3953)
      .map((record) => record.key),
    [3953, 3951, 3952],
  );
  const allByName = listContactsMatching({}, { sortBy: "name" }).map(
    (record) => record.key,
  );
  assert.deepEqual(
    listContactsMatching({}, { sortBy: "name", limit: 2, offset: 1 }).map(
      (record) => record.key,
    ),
    allByName.slice(1, 3),
  );
  assert.throws(
    () => listContactsMatching({}, { limit: -1 }),
    /limit must be a non-negative integer/,
  );
  assert.throws(
    () => listContactsMatching({}, { offset: 1.5 }),
    /offset must be a non-negative integer/,
  );
});
