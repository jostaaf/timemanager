import { listContacts } from "../../db/contact.js";
import type { ContactRecord } from "../../db/types.js";
import type { ContactSearchCriteria } from "../../db/contact.js";

export function listContactsMatching(
  criteria: ContactSearchCriteria = {},
): ContactRecord[] {
  return listContacts(criteria);
}
