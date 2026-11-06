import type {
  ContactRecord,
  ContactUpdate,
  NewContactRecord,
} from "./types.js";
import { db } from "./client.js";
import {
  deleteRecord,
  updateRecord,
  type OptimisticDeleteResult,
  type OptimisticUpdateResult,
} from "./optimistic-update.js";

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
  return deleteRecord<ContactRecord>("contact", key, expectedVersion);
}
