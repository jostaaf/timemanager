import { runInImmediateTransaction } from "../../db/client.js";
import { getContactByKey, updateContact } from "../../db/contact.js";
import {
  deleteContactSocial,
  getContactSocialByKey,
  getContactSocialsForContact,
  insertContactSocial,
  insertContactSocialWithGeneratedKey,
  updateContactSocial,
} from "../../db/contact-socials.js";
import type {
  ContactRecord,
  ContactSocialsRecord,
  ContactUpdate,
  ContactSocialsUpdate,
} from "../../db/types.js";
import type { NewContactSocial } from "../../db/contact-service.js";

export type ContactSocialChange =
  | {
      type: "add";
      key?: number;
      record: Omit<NewContactSocial, "key" | "version"> & {
        version?: number;
      };
    }
  | {
      type: "update";
      key: number;
      expectedVersion: number;
      changes: Omit<ContactSocialsUpdate, "contact_key">;
    }
  | { type: "delete"; key: number; expectedVersion: number };

export interface UpdateContactWithSocialsInput {
  contactKey: number;
  expectedVersion: number;
  changes: ContactUpdate;
  socialChanges: readonly ContactSocialChange[];
}

export type UpdateContactWithSocialsResult =
  | {
      status: "updated";
      contact: ContactRecord;
      socials: ContactSocialsRecord[];
    }
  | { status: "contact_not_found" }
  | { status: "contact_conflict"; currentVersion: number }
  | { status: "social_not_found"; socialKey: number }
  | {
      status: "social_conflict";
      socialKey: number;
      currentVersion: number;
    };

export function updateContactWithSocials(
  input: UpdateContactWithSocialsInput,
): UpdateContactWithSocialsResult {
  return runInImmediateTransaction(() => {
    const contact = getContactByKey(input.contactKey);
    if (!contact) {
      return { status: "contact_not_found" };
    }
    if (contact.version !== input.expectedVersion) {
      return {
        status: "contact_conflict",
        currentVersion: contact.version,
      };
    }

    for (const change of input.socialChanges) {
      if (change.type === "add") {
        continue;
      }

      const social = getContactSocialByKey(change.key);
      if (!social || social.contact_key !== input.contactKey) {
        return { status: "social_not_found", socialKey: change.key };
      }
      if (social.version !== change.expectedVersion) {
        return {
          status: "social_conflict",
          socialKey: change.key,
          currentVersion: social.version,
        };
      }
    }

    const contactResult = updateContact(
      input.contactKey,
      input.expectedVersion,
      input.changes,
    );
    if (contactResult.status !== "updated") {
      throw new Error("Contact changed during an immediate transaction");
    }

    for (const change of input.socialChanges) {
      if (change.type === "add") {
        if (change.key === undefined) {
          insertContactSocialWithGeneratedKey({
            ...change.record,
            contact_key: input.contactKey,
          });
        } else {
          insertContactSocial({
            ...change.record,
            key: change.key,
            version: change.record.version ?? 1,
            contact_key: input.contactKey,
          });
        }
      } else if (change.type === "update") {
        const result = updateContactSocial(
          change.key,
          change.expectedVersion,
          change.changes,
        );
        if (result.status !== "updated") {
          throw new Error("Contact social changed during an immediate transaction");
        }
      } else {
        const result = deleteContactSocial(
          change.key,
          change.expectedVersion,
        );
        if (result.status !== "deleted") {
          throw new Error("Contact social changed during an immediate transaction");
        }
      }
    }

    return {
      status: "updated",
      contact: contactResult.record,
      socials: getContactSocialsForContact(input.contactKey),
    };
  });
}
