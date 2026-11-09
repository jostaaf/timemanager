import { getContactByKey } from "../../db/contact.js";
import { getContactSocialsForContact } from "../../db/contact-socials.js";
import type { ContactWithSocials } from "../../db/contact-service.js";

export function getContactWithSocials(
  contactKey: number,
): ContactWithSocials | undefined {
  const contact = getContactByKey(contactKey);
  if (!contact) return undefined;
  return {
    contact,
    socials: getContactSocialsForContact(contactKey),
  };
}
