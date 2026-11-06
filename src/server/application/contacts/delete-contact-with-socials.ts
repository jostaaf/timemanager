import { runInImmediateTransaction } from "../../db/client.js";
import { deleteContact } from "../../db/contact.js";
import type { OptimisticDeleteResult } from "../../db/optimistic-update.js";
import type { ContactRecord } from "../../db/types.js";

export function deleteContactWithSocials(
  contactKey: number,
  expectedVersion: number,
): OptimisticDeleteResult<ContactRecord> {
  return runInImmediateTransaction(() =>
    deleteContact(contactKey, expectedVersion),
  );
}
