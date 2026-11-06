import type {
  ContactSocialsRecord,
  ContactSocialsUpdate,
  NewContactSocialsRecord,
} from "./types.js";
import { db } from "./client.js";
import {
  deleteRecord,
  updateRecord,
  type OptimisticDeleteResult,
  type OptimisticUpdateResult,
} from "./optimistic-update.js";

export function insertContactSocial(
  record: NewContactSocialsRecord,
): ContactSocialsRecord {
  const inserted = db
    .prepare<NewContactSocialsRecord, ContactSocialsRecord>(
      `INSERT INTO contact_socials
        ("key", "version", "contact_key", "media", "userid", "comment")
       VALUES
        (@key, @version, @contact_key, @media, @userid, @comment)
       RETURNING *`,
    )
    .get(record);
  if (!inserted) {
    throw new Error("Inserting contact social did not return a record");
  }
  return inserted;
}

export function updateContactSocial(
  key: number,
  expectedVersion: number,
  changes: ContactSocialsUpdate,
): OptimisticUpdateResult<ContactSocialsRecord> {
  return updateRecord<ContactSocialsRecord>(
    "contact_socials",
    key,
    expectedVersion,
    changes,
  );
}

export function deleteContactSocial(
  key: number,
  expectedVersion: number,
): OptimisticDeleteResult<ContactSocialsRecord> {
  return deleteRecord<ContactSocialsRecord>(
    "contact_socials",
    key,
    expectedVersion,
  );
}
