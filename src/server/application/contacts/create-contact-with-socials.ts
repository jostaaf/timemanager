import { runInImmediateTransaction } from "../../db/client.js";
import {
  createContactWithSocials as createContactAndSocials,
  type ContactWithSocials,
  type NewContactSocial,
} from "../../db/contact-service.js";
import { insertContactWithGeneratedKey } from "../../db/contact.js";
import { insertContactSocialWithGeneratedKey } from "../../db/contact-socials.js";
import type {
  ContactRecord,
  ContactSocialsRecord,
  NewContactRecord,
} from "../../db/types.js";

export function createContactWithSocials(
  contact: NewContactRecord,
  socials: readonly NewContactSocial[],
): ContactWithSocials {
  return runInImmediateTransaction(() =>
    createContactAndSocials(contact, socials),
  );
}

export function createContactWithGeneratedKeys(
  contact: Omit<ContactRecord, "key" | "version">,
  socials: readonly Omit<ContactSocialsRecord, "key" | "version" | "contact_key">[],
): ContactWithSocials {
  return runInImmediateTransaction(() => {
    const createdContact = insertContactWithGeneratedKey(contact);
    const createdSocials = socials.map((social) =>
      insertContactSocialWithGeneratedKey({
        ...social,
        contact_key: createdContact.key,
      }),
    );
    return { contact: createdContact, socials: createdSocials };
  });
}
