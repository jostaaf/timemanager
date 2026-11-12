import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectContactValues,
  collectEventContactChanges,
  collectEventValues,
  collectNoteAssignments,
  collectNoteValues,
  collectSocialChanges,
  formatLocalDateTime,
  shouldShowEventContactAssignment,
  toLocalDateInput,
  toLocalTimeInput,
} from "../src/client/form-model.js";

const identity = (message) => message;

test("contact form values trim input, preserve required fields, and normalize optional blanks", () => {
  const fields = [
    ["name", "Name", true],
    ["email", "Email", false],
  ];
  assert.deepEqual(
    collectContactValues({ name: " Ada ", email: " " }, fields, identity),
    { name: "Ada", email: null },
  );
  assert.throws(
    () => collectContactValues({ name: " ", email: "" }, fields, identity),
    { message: "Name is required." },
  );
});

test("social form changes represent add, update, delete, and blank new rows", () => {
  const existing = {
    key: 12,
    version: 3,
    media: "Mastodon",
    userid: "ada",
    comment: null,
  };
  const removed = { key: 13, version: 1 };
  assert.deepEqual(
    collectSocialChanges([
      {
        original: existing,
        media: "Mastodon",
        userid: "ada-lovelace",
        comment: "",
      },
      {
        original: null,
        media: "Bluesky",
        userid: "ada",
        comment: "",
      },
      { original: null, media: "", userid: "", comment: "" },
    ], true, [existing, removed], identity),
    {
      values: [],
      changes: [{
        type: "update",
        key: 12,
        expectedVersion: 3,
        changes: { userid: "ada-lovelace" },
      }, {
        type: "add",
        record: { media: "Bluesky", userid: "ada", comment: null },
      }, {
        type: "delete",
        key: 13,
        expectedVersion: 1,
      }],
    },
  );
  assert.throws(
    () => collectSocialChanges(
      [{ original: null, media: "", userid: "user", comment: "" }],
      false,
      [],
      identity,
    ),
    { message: "Every social account needs a platform." },
  );
});

test("event date and time fields normalize locally and reject invalid ranges", () => {
  const start = new Date(2026, 0, 2, 9, 15);
  const end = new Date(2026, 0, 2, 10, 15);
  const toValues = (startDate, startTime, endDate, endTime) => ({
    name: " Review ",
    startDate,
    startTime,
    endDate,
    endTime,
    comment: " ",
  });
  assert.deepEqual(
    collectEventValues(toValues(
      toLocalDateInput(start),
      toLocalTimeInput(start),
      toLocalDateInput(end),
      toLocalTimeInput(end),
    ), identity),
    {
      name: "Review",
      start: start.toISOString(),
      end: end.toISOString(),
      comment: null,
    },
  );
  assert.equal(toLocalDateInput("invalid"), "");
  assert.equal(toLocalTimeInput("invalid"), "");
  const startIso = start.toISOString();
  assert.equal(
    formatLocalDateTime(startIso),
    `${toLocalDateInput(startIso)} ${toLocalTimeInput(startIso)}`,
  );
  assert.throws(
    () => collectEventValues(toValues(
      "2026-02-30",
      "09:15",
      "2026-03-02",
      "10:15",
    ), identity),
    { message: "Enter valid dates and times." },
  );
  assert.throws(
    () => collectEventValues(toValues(
      "2026-01-02",
      "24:00",
      "2026-01-02",
      "10:15",
    ), identity),
    { message: "Enter valid dates and times." },
  );
  assert.throws(
    () => collectEventValues(toValues(
      toLocalDateInput(end),
      toLocalTimeInput(end),
      toLocalDateInput(start),
      toLocalTimeInput(start),
    ), identity),
    { message: "Event end must be later than its start." },
  );
  assert.throws(
    () => collectEventValues(toValues(
      "2026-01-02",
      "09:15",
      "2026-01-02",
      "",
    ), identity),
    { message: "Event dates and times are required." },
  );
});

test("event contact selections produce additions, role updates, and removals", () => {
  const existing = {
    key: 20,
    version: 2,
    contact_key: 8,
    role: "host",
  };
  assert.deepEqual(
    collectEventContactChanges([{
      contact: { key: 8 },
      original: existing,
      role: "organizer",
      selected: true,
    }, {
      contact: { key: 9 },
      original: null,
      role: "attendee",
      selected: true,
    }, {
      contact: { key: 10 },
      original: { key: 21, version: 1, role: null },
      role: "",
      selected: false,
    }]),
    {
      contacts: [{ contactKey: 9, role: "attendee" }],
      changes: [{
        type: "update",
        key: 20,
        expectedVersion: 2,
        changes: { role: "organizer" },
      }, {
        type: "delete",
        key: 21,
        expectedVersion: 1,
      }],
    },
  );
});

test("event edits encode newly selected contacts as add changes", () => {
  assert.deepEqual(
    collectEventContactChanges([{
      contact: { key: 22 },
      original: null,
      role: "speaker",
      selected: true,
    }], true),
    {
      contacts: [],
      changes: [{
        type: "add",
        contactKey: 22,
        role: "speaker",
      }],
    },
  );
});

test("event contact search matches details while keeping assigned selections visible", () => {
  const contact = { name: "Ada Lovelace", city: "London", email: "ada@example.test" };
  assert.equal(shouldShowEventContactAssignment({
    contact,
    original: null,
    selected: false,
  }, "  LONDON "), true);
  assert.equal(shouldShowEventContactAssignment({
    contact,
    original: null,
    selected: false,
  }, "missing"), false);
  assert.equal(shouldShowEventContactAssignment({
    contact,
    original: null,
    selected: true,
  }, "missing"), true);
  assert.equal(shouldShowEventContactAssignment({
    contact,
    original: { key: 12 },
    selected: false,
  }, "missing"), true);
});

test("note values require trimmed heading and text", () => {
  assert.deepEqual(
    collectNoteValues({ heading: " Plan ", text: " Body " }, identity),
    { heading: "Plan", text: "Body" },
  );
  assert.throws(
    () => collectNoteValues({ heading: " ", text: "Body" }, identity),
    { message: "Note heading is required." },
  );
  assert.throws(
    () => collectNoteValues({ heading: "Plan", text: " " }, identity),
    { message: "Note text is required." },
  );
});

test("note assignments collect the selected contacts and events", () => {
  assert.deepEqual(collectNoteAssignments([], []), {
    contactKeys: [],
    eventKeys: [],
  });
  assert.deepEqual(
    collectNoteAssignments([
      { contact: { key: 4 }, selected: true },
      { contact: { key: 5 }, selected: false },
    ], [
      { event: { key: 6 }, selected: false },
      { event: { key: 7 }, selected: true },
    ]),
    { contactKeys: [4], eventKeys: [7] },
  );
});
