import type {
  ContactRecord,
  ContactUpdate,
  NewContactRecord,
} from "./types.js";
import { db } from "./client.js";
import {
  updateRecord,
  type OptimisticUpdateResult,
} from "./optimistic-update.js";
import { deleteParentAndPreserveNotes } from "./delete-parent.js";
import type { OptimisticDeleteResult } from "./optimistic-update.js";

export interface ContactSearchCriteria {
  name?: string;
  address?: string;
  zip?: string;
  city?: string;
}

function containsPattern(value: string): string {
  const escaped = value.replace(/[!%_]/g, "!$&");
  return `%${escaped}%`;
}

export function insertContact(
  record: NewContactRecord,
): ContactRecord {
  const inserted = db
    .prepare<NewContactRecord, ContactRecord>(
      `INSERT INTO contact
        ("key", "version", "name", "street", "postcode", "city", "phone", "email", "tag", "comment")
       VALUES
        (@key, @version, @name, @street, @postcode, @city, @phone, @email, @tag, @comment)
       RETURNING *`,
    )
    .get(record);
  if (!inserted) {
    throw new Error("Inserting contact did not return a record");
  }
  return inserted;
}

export function getContactByKey(key: number): ContactRecord | undefined {
  return db
    .prepare<[number], ContactRecord>('SELECT * FROM contact WHERE "key" = ?')
    .get(key);
}

export function listContacts(
  criteria: ContactSearchCriteria = {},
): ContactRecord[] {
  const filters: [column: string, value: string][] = [
    ['"name" COLLATE NOCASE', criteria.name ?? ""],
    ['"street" COLLATE NOCASE', criteria.address ?? ""],
    ['CAST("postcode" AS TEXT) COLLATE NOCASE', criteria.zip ?? ""],
    ['"city" COLLATE NOCASE', criteria.city ?? ""],
  ];
  const predicates: string[] = [];
  const parameters: string[] = [];

  for (const [column, rawValue] of filters) {
    const value = rawValue.trim();
    if (value.length === 0) continue;
    predicates.push(`${column} LIKE ? ESCAPE '!'`);
    parameters.push(containsPattern(value));
  }

  const whereClause =
    predicates.length > 0 ? `WHERE ${predicates.join(" AND ")}` : "";
  return db
    .prepare<string[], ContactRecord>(
      `SELECT *
       FROM contact
       ${whereClause}
       ORDER BY "name" COLLATE NOCASE, "key"`,
    )
    .all(...parameters);
}

export function updateContact(
  key: number,
  expectedVersion: number,
  changes: ContactUpdate,
): OptimisticUpdateResult<ContactRecord> {
  return updateRecord<ContactRecord>("contact", key, expectedVersion, changes);
}

export function deleteContact(
  key: number,
  expectedVersion: number,
): OptimisticDeleteResult<ContactRecord> {
  return deleteParentAndPreserveNotes<ContactRecord>(
    "contact",
    "note_contacts",
    "contact_key",
    key,
    expectedVersion,
  );
}
