import {
  listContacts,
  type ContactListingOptions,
} from "../../db/contact.js";
import type { ContactRecord } from "../../db/types.js";
import type { ContactSearchCriteria } from "../../db/contact.js";

export function listContactsMatching(
  criteria: ContactSearchCriteria = {},
  options: ContactListingOptions = {},
): ContactRecord[] {
  return listContacts(criteria, options);
}
