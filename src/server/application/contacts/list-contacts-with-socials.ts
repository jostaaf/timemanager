import {
  listContactsWithSocials as queryContactsWithSocials,
  type ContactListingOptions,
  type ContactSearchCriteria,
  type ContactWithSocials,
} from "../../db/contact.js";

export function listContactsWithSocials(
  criteria: ContactSearchCriteria = {},
  options: ContactListingOptions = {},
): ContactWithSocials[] {
  return queryContactsWithSocials(criteria, options);
}
