import { runInImmediateTransaction } from "../../db/client.js";
import {
  createContactWithSocials as createContactAndSocials,
  type ContactWithSocials,
  type NewContactSocial,
} from "../../db/contact-service.js";
import type { NewContactRecord } from "../../db/types.js";

export function createContactWithSocials(
  contact: NewContactRecord,
  socials: readonly NewContactSocial[],
): ContactWithSocials {
  return runInImmediateTransaction(() =>
    createContactAndSocials(contact, socials),
  );
}
