import { db } from "./client.js";
import { insertContact } from "./contact.js";
import { insertContactSocial } from "./contact-socials.js";
import type {
  ContactRecord,
  ContactSocialsRecord,
  NewContactRecord,
  NewContactSocialsRecord,
} from "./types.js";

export type NewContactSocial = Omit<NewContactSocialsRecord, "contact_key">;

export interface ContactWithSocials {
  contact: ContactRecord;
  socials: ContactSocialsRecord[];
}

export function createContactWithSocials(
  contact: NewContactRecord,
  socials: readonly NewContactSocial[],
): ContactWithSocials {
  return db.transaction(() => {
    const createdContact = insertContact(contact);
    const createdSocials = socials.map((social) =>
      insertContactSocial({ ...social, contact_key: createdContact.key }),
    );
    return { contact: createdContact, socials: createdSocials };
  })();
}
