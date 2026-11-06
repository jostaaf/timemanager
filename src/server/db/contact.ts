import type {
  ContactRecord,
  ContactSocialsRecord,
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
  phone?: string;
  email?: string;
  tag?: string;
  socialMedia?: string;
  socialUserId?: string;
}

export type ContactSortField =
  | "name"
  | "address"
  | "zip"
  | "city"
  | "phone"
  | "email"
  | "tag";

export interface ContactListingOptions {
  sortBy?: ContactSortField;
  sortDirection?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface ContactWithSocials {
  contact: ContactRecord;
  socials: ContactSocialsRecord[];
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
        ("key", "version", "name", "street", "zip", "city", "phone", "email", "tag", "comment")
       VALUES
        (@key, @version, @name, @street, @zip, @city, @phone, @email, @tag, @comment)
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
  options: ContactListingOptions = {},
): ContactRecord[] {
  const filters: [column: string, value: string][] = [
    ['"name" COLLATE NOCASE', criteria.name ?? ""],
    ['"street" COLLATE NOCASE', criteria.address ?? ""],
    ['"zip" COLLATE NOCASE', criteria.zip ?? ""],
    ['"city" COLLATE NOCASE', criteria.city ?? ""],
    ['"phone" COLLATE NOCASE', criteria.phone ?? ""],
    ['"email" COLLATE NOCASE', criteria.email ?? ""],
    ['"tag" COLLATE NOCASE', criteria.tag ?? ""],
  ];
  const predicates: string[] = [];
  const parameters: string[] = [];

  for (const [column, rawValue] of filters) {
    const value = rawValue.trim();
    if (value.length === 0) continue;
    predicates.push(`${column} LIKE ? ESCAPE '!'`);
    parameters.push(containsPattern(value));
  }

  const socialMedia = criteria.socialMedia?.trim();
  const socialUserId = criteria.socialUserId?.trim();
  if (socialMedia || socialUserId) {
    const socialPredicates = [
      'contact_socials."contact_key" = contact."key"',
    ];
    if (socialMedia) {
      socialPredicates.push(
        'contact_socials."media" = ? COLLATE NOCASE',
      );
      parameters.push(socialMedia);
    }
    if (socialUserId) {
      socialPredicates.push(
        'contact_socials."userid" LIKE ? ESCAPE \'!\' COLLATE NOCASE',
      );
      parameters.push(containsPattern(socialUserId));
    }
    predicates.push(
      `EXISTS (
         SELECT 1
         FROM contact_socials
         WHERE ${socialPredicates.join(" AND ")}
       )`,
    );
  }

  const sortColumns: Record<ContactSortField, string> = {
    name: '"name" COLLATE NOCASE',
    address: '"street" COLLATE NOCASE',
    zip: '"zip" COLLATE NOCASE',
    city: '"city" COLLATE NOCASE',
    phone: '"phone" COLLATE NOCASE',
    email: '"email" COLLATE NOCASE',
    tag: '"tag" COLLATE NOCASE',
  };
  const sortBy = options.sortBy ?? "name";
  const sortColumn = sortColumns[sortBy];
  if (!sortColumn) {
    throw new TypeError(`Unsupported contact sort field: ${sortBy}`);
  }
  const sortDirection = options.sortDirection ?? "asc";
  if (sortDirection !== "asc" && sortDirection !== "desc") {
    throw new TypeError(`Unsupported contact sort direction: ${sortDirection}`);
  }
  if (
    options.limit !== undefined &&
    (!Number.isSafeInteger(options.limit) || options.limit < 0)
  ) {
    throw new RangeError("Contact listing limit must be a non-negative integer");
  }
  const offset = options.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError("Contact listing offset must be a non-negative integer");
  }

  const whereClause =
    predicates.length > 0 ? `WHERE ${predicates.join(" AND ")}` : "";
  const pagination = options.limit === undefined
    ? offset > 0
      ? "LIMIT -1 OFFSET ?"
      : ""
    : offset > 0
      ? "LIMIT ? OFFSET ?"
      : "LIMIT ?";
  if (options.limit !== undefined) {
    parameters.push(String(options.limit));
  }
  if (offset > 0) {
    parameters.push(String(offset));
  }
  return db
    .prepare<string[], ContactRecord>(
      `SELECT *
       FROM contact
       ${whereClause}
       ORDER BY ${sortColumn} ${sortDirection.toUpperCase()}, "key"
       ${pagination}`,
    )
    .all(...parameters);
}

export function listContactsWithSocials(
  criteria: ContactSearchCriteria = {},
  options: ContactListingOptions = {},
): ContactWithSocials[] {
  const contacts = listContacts(criteria, options);
  if (contacts.length === 0) {
    return [];
  }

  const placeholders = contacts.map(() => "?").join(", ");
  const socials = db
    .prepare<number[], ContactSocialsRecord>(
      `SELECT *
       FROM contact_socials
       WHERE "contact_key" IN (${placeholders})
       ORDER BY "contact_key", "key"`,
    )
    .all(...contacts.map((contact) => contact.key));
  const socialsByContact = new Map<number, ContactSocialsRecord[]>();
  for (const social of socials) {
    const records = socialsByContact.get(social.contact_key) ?? [];
    records.push(social);
    socialsByContact.set(social.contact_key, records);
  }

  return contacts.map((contact) => ({
    contact,
    socials: socialsByContact.get(contact.key) ?? [],
  }));
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
