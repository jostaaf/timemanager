import type {
  ContactRecord,
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

export function insertContactSocialWithGeneratedKey(
  record: Omit<ContactSocialsRecord, "key" | "version">,
): ContactSocialsRecord {
  const inserted = db
    .prepare<Omit<ContactSocialsRecord, "key" | "version">, ContactSocialsRecord>(
      `INSERT INTO contact_socials
        ("version", "contact_key", "media", "userid", "comment")
       VALUES
        (1, @contact_key, @media, @userid, @comment)
       RETURNING *`,
    )
    .get(record);
  if (!inserted) {
    throw new Error("Inserting contact social did not return a record");
  }
  return inserted;
}

export function getContactSocialByKey(
  key: number,
): ContactSocialsRecord | undefined {
  return db
    .prepare<[number], ContactSocialsRecord>(
      'SELECT * FROM contact_socials WHERE "key" = ?',
    )
    .get(key);
}

export function getContactSocialsForContact(
  contactKey: number,
): ContactSocialsRecord[] {
  return db
    .prepare<[number], ContactSocialsRecord>(
      `SELECT *
       FROM contact_socials
       WHERE "contact_key" = ?
       ORDER BY "key"`,
    )
    .all(contactKey);
}

export function listContactsBySocialMedia(media: string): ContactRecord[] {
  const searchMedia = media.trim();
  if (searchMedia.length === 0) {
    throw new TypeError("Social media platform must not be empty");
  }

  return db
    .prepare<[string], ContactRecord>(
      `SELECT contact.*
       FROM contact
       WHERE EXISTS (
         SELECT 1
         FROM contact_socials
         WHERE contact_socials."contact_key" = contact."key"
           AND contact_socials."media" = ? COLLATE NOCASE
       )
       ORDER BY contact."name" COLLATE NOCASE, contact."key"`,
    )
    .all(searchMedia);
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
