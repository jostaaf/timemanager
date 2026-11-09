import {
  createContactWithGeneratedKeys,
} from "../application/contacts/create-contact-with-socials.js";
import {
  deleteContactWithSocials,
} from "../application/contacts/delete-contact-with-socials.js";
import { getContactWithSocials } from "../application/contacts/get-contact-with-socials.js";
import {
  listContactsWithSocials,
} from "../application/contacts/list-contacts-with-socials.js";
import {
  updateContactWithSocials,
  type ContactSocialChange,
} from "../application/contacts/update-contact-with-socials.js";

export interface ApiResponse {
  status: number;
  body?: unknown;
}

export interface ContactDto {
  key: number;
  version: number;
  name: string;
  street: string;
  zip: string;
  city: string;
  phone: string | null;
  email: string | null;
  tag: string | null;
  comment: string | null;
}

export interface ContactSocialDto {
  key: number;
  version: number;
  contact_key: number;
  media: string;
  userid: string | null;
  comment: string | null;
}

type CreateContactDto = Omit<ContactDto, "key" | "version">;
type CreateContactSocialDto = Pick<
  ContactSocialDto,
  "media" | "userid" | "comment"
>;
type AddedContactSocialDto = CreateContactSocialDto & { version?: number };

type ContactChangesDto = Partial<Omit<ContactDto, "key" | "version">>;
type SocialChangesDto = Partial<
  Pick<ContactSocialDto, "media" | "userid" | "comment">
>;
type ContactSortField =
  | "name"
  | "address"
  | "zip"
  | "city"
  | "phone"
  | "email"
  | "tag";

interface ContactSearchDto {
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

interface ContactListingDto {
  sortBy?: ContactSortField;
  sortDirection?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

const contactSortFields: readonly ContactSortField[] = [
  "name",
  "address",
  "zip",
  "city",
  "phone",
  "email",
  "tag",
];

interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

class InvalidRequestError extends Error {}

function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): ApiResponse {
  const error: ApiErrorBody["error"] = { code, message };
  if (details !== undefined) error.details = details;
  return { status, body: { error } };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new InvalidRequestError(`Unexpected field: ${key}`);
    }
  }
  for (const key of required) {
    if (!(key in value)) {
      throw new InvalidRequestError(`Missing field: ${key}`);
    }
  }
}

function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new InvalidRequestError(`${field} must be a safe integer`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  const result = integer(value, field);
  if (result < 1) {
    throw new InvalidRequestError(`${field} must be a positive integer`);
  }
  return result;
}

function nonNegativeInteger(value: unknown, field: string): number {
  const result = integer(value, field);
  if (result < 0) {
    throw new InvalidRequestError(`${field} must be a non-negative integer`);
  }
  return result;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidRequestError(`${field} must be a non-empty string`);
  }
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value !== null && typeof value !== "string") {
    throw new InvalidRequestError(`${field} must be a string or null`);
  }
  return value;
}

const contactFields = [
  "name",
  "street",
  "zip",
  "city",
  "phone",
  "email",
  "tag",
  "comment",
] as const;
const socialFields = ["media", "userid", "comment"] as const;

function parseContactFields(value: unknown): CreateContactDto {
  if (!isObject(value)) {
    throw new InvalidRequestError("contact must be an object");
  }
  assertKeys(value, contactFields);
  return {
    name: nonEmptyString(value.name, "contact.name"),
    street: nonEmptyString(value.street, "contact.street"),
    zip: nonEmptyString(value.zip, "contact.zip"),
    city: nonEmptyString(value.city, "contact.city"),
    phone: nullableString(value.phone, "contact.phone"),
    email: nullableString(value.email, "contact.email"),
    tag: nullableString(value.tag, "contact.tag"),
    comment: nullableString(value.comment, "contact.comment"),
  };
}

function parseNewSocial(value: unknown, field: string): CreateContactSocialDto {
  if (!isObject(value)) {
    throw new InvalidRequestError(`${field} must be an object`);
  }
  assertKeys(value, socialFields);
  return {
    media: nonEmptyString(value.media, `${field}.media`),
    userid: nullableString(value.userid, `${field}.userid`),
    comment: nullableString(value.comment, `${field}.comment`),
  };
}

function parseAddedSocial(
  value: unknown,
  field: string,
): AddedContactSocialDto {
  if (!isObject(value)) {
    throw new InvalidRequestError(`${field} must be an object`);
  }
  assertKeys(value, socialFields, ["version"]);
  const record: AddedContactSocialDto = {
    media: nonEmptyString(value.media, `${field}.media`),
    userid: nullableString(value.userid, `${field}.userid`),
    comment: nullableString(value.comment, `${field}.comment`),
  };
  if ("version" in value) {
    record.version = positiveInteger(value.version, `${field}.version`);
  }
  return record;
}

function parseContactUpdate(value: unknown): ContactChangesDto {
  if (!isObject(value)) {
    throw new InvalidRequestError("changes must be an object");
  }
  assertKeys(value, [], contactFields);
  const changes: ContactChangesDto = {};
  if ("name" in value) changes.name = nonEmptyString(value.name, "changes.name");
  if ("street" in value) changes.street = nonEmptyString(value.street, "changes.street");
  if ("zip" in value) changes.zip = nonEmptyString(value.zip, "changes.zip");
  if ("city" in value) changes.city = nonEmptyString(value.city, "changes.city");
  if ("phone" in value) changes.phone = nullableString(value.phone, "changes.phone");
  if ("email" in value) changes.email = nullableString(value.email, "changes.email");
  if ("tag" in value) changes.tag = nullableString(value.tag, "changes.tag");
  if ("comment" in value) {
    changes.comment = nullableString(value.comment, "changes.comment");
  }
  return changes;
}

function parseSocialChanges(value: unknown): readonly ContactSocialChange[] {
  if (!Array.isArray(value)) {
    throw new InvalidRequestError("socialChanges must be an array");
  }
  return value.map((item, index): ContactSocialChange => {
    const field = `socialChanges[${index}]`;
    if (!isObject(item) || typeof item.type !== "string") {
      throw new InvalidRequestError(`${field}.type must be a string`);
    }
    if (item.type === "add") {
      assertKeys(item, ["type", "record"], ["key"]);
      const change: ContactSocialChange = {
        type: "add",
        record: parseAddedSocial(item.record, `${field}.record`),
      };
      if ("key" in item) {
        return {
          ...change,
          key: positiveInteger(item.key, `${field}.key`),
        };
      }
      return change;
    }
    if (item.type === "update") {
      assertKeys(item, ["type", "key", "expectedVersion", "changes"]);
      if (!isObject(item.changes)) {
        throw new InvalidRequestError(`${field}.changes must be an object`);
      }
      assertKeys(item.changes, [], socialFields);
      const changes: SocialChangesDto = {};
      for (const socialField of socialFields) {
        if (!(socialField in item.changes)) continue;
        const fieldValue = item.changes[socialField];
        if (socialField === "media") {
          changes.media = nonEmptyString(fieldValue, `${field}.changes.media`);
        } else if (fieldValue !== null && typeof fieldValue !== "string") {
          throw new InvalidRequestError(
            `${field}.changes.${socialField} must be a string or null`,
          );
        } else {
          changes[socialField] = fieldValue;
        }
      }
      return {
        type: "update",
        key: positiveInteger(item.key, `${field}.key`),
        expectedVersion: nonNegativeInteger(
          item.expectedVersion,
          `${field}.expectedVersion`,
        ),
        changes,
      };
    }
    if (item.type === "delete") {
      assertKeys(item, ["type", "key", "expectedVersion"]);
      return {
        type: "delete",
        key: positiveInteger(item.key, `${field}.key`),
        expectedVersion: nonNegativeInteger(
          item.expectedVersion,
          `${field}.expectedVersion`,
        ),
      };
    }
    throw new InvalidRequestError(`${field}.type must be add, update, or delete`);
  });
}

function parseListingOptions(params: URLSearchParams): {
  criteria: ContactSearchDto;
  options: ContactListingDto;
} {
  const criteria: ContactSearchDto = {};
  for (const field of [
    "name",
    "address",
    "zip",
    "city",
    "phone",
    "email",
    "tag",
    "socialMedia",
    "socialUserId",
  ] as const) {
    const value = params.get(field);
    if (value !== null) criteria[field] = value;
  }

  const options: ContactListingDto = {};
  const sortBy = params.get("sortBy");
  if (sortBy !== null) {
    if (!contactSortFields.includes(sortBy as ContactSortField)) {
      throw new InvalidRequestError("sortBy is not a supported contact field");
    }
    options.sortBy = sortBy as ContactSortField;
  }
  const sortDirection = params.get("sortDirection");
  if (sortDirection !== null) {
    if (sortDirection !== "asc" && sortDirection !== "desc") {
      throw new InvalidRequestError("sortDirection must be asc or desc");
    }
    options.sortDirection = sortDirection;
  }
  for (const field of ["limit", "offset"] as const) {
    const value = params.get(field);
    if (value === null) continue;
    if (!/^(0|[1-9]\d*)$/.test(value)) {
      throw new InvalidRequestError(`${field} must be a non-negative integer`);
    }
    const number = Number(value);
    if (!Number.isSafeInteger(number)) {
      throw new InvalidRequestError(`${field} must be a safe integer`);
    }
    options[field] = number;
  }
  return { criteria, options };
}

function toContactDto(contact: ContactDto): ContactDto {
  return {
    key: contact.key,
    version: contact.version,
    name: contact.name,
    street: contact.street,
    zip: contact.zip,
    city: contact.city,
    phone: contact.phone,
    email: contact.email,
    tag: contact.tag,
    comment: contact.comment,
  };
}

function toContactSocialDto(social: ContactSocialDto): ContactSocialDto {
  return {
    key: social.key,
    version: social.version,
    contact_key: social.contact_key,
    media: social.media,
    userid: social.userid,
    comment: social.comment,
  };
}

function parseBodyObject(body: unknown): Record<string, unknown> {
  if (!isObject(body)) {
    throw new InvalidRequestError("Request body must be a JSON object");
  }
  return body;
}

function isConstraintError(error: unknown): boolean {
  return isObject(error) &&
    typeof error.code === "string" &&
    error.code.startsWith("SQLITE_CONSTRAINT_");
}

export function handleContactsApiRequest(
  method: string,
  url: URL,
  body?: unknown,
): ApiResponse {
  try {
    if (url.pathname === "/api/contacts") {
      if (method === "GET") {
        const { criteria, options } = parseListingOptions(url.searchParams);
        return {
          status: 200,
          body: {
            contacts: listContactsWithSocials(criteria, options).map(
              ({ contact, socials }) => ({
                contact: toContactDto(contact),
                socials: socials.map(toContactSocialDto),
              }),
            ),
          },
        };
      }
      if (method === "POST") {
        const request = parseBodyObject(body);
        assertKeys(request, ["contact"], ["socials"]);
        const socials = request.socials ?? [];
        if (!Array.isArray(socials)) {
          throw new InvalidRequestError("socials must be an array");
        }
        const result = createContactWithGeneratedKeys(
          parseContactFields(request.contact),
          socials.map((social, index) => parseNewSocial(social, `socials[${index}]`)),
        );
        return {
          status: 201,
          body: {
            contact: toContactDto(result.contact),
            socials: result.socials.map(toContactSocialDto),
          },
        };
      }
      return errorResponse(405, "method_not_allowed", "Method not allowed");
    }

    const contactMatch = /^\/api\/contacts\/([1-9]\d*)$/.exec(url.pathname);
    if (!contactMatch) {
      return errorResponse(404, "not_found", "API route not found");
    }
    const key = Number(contactMatch[1]);
    if (!Number.isSafeInteger(key) || key < 1) {
      throw new InvalidRequestError("Contact key must be a safe integer");
    }

    if (method === "GET") {
      const result = getContactWithSocials(key);
      if (!result) {
        return errorResponse(404, "contact_not_found", "Contact not found");
      }
      return {
        status: 200,
        body: {
          contact: toContactDto(result.contact),
          socials: result.socials.map(toContactSocialDto),
        },
      };
    }

    if (method === "PATCH") {
      const request = parseBodyObject(body);
      assertKeys(request, ["expectedVersion", "changes", "socialChanges"]);
      const result = updateContactWithSocials({
        contactKey: key,
        expectedVersion: nonNegativeInteger(
          request.expectedVersion,
          "expectedVersion",
        ),
        changes: parseContactUpdate(request.changes),
        socialChanges: parseSocialChanges(request.socialChanges),
      });
      if (result.status === "updated") {
        return {
          status: 200,
          body: {
            status: result.status,
            contact: toContactDto(result.contact),
            socials: result.socials.map(toContactSocialDto),
          },
        };
      }
      if (result.status === "contact_not_found" || result.status === "social_not_found") {
        return errorResponse(404, result.status, "Contact or social record not found");
      }
      return errorResponse(409, result.status, "Contact or social version conflict", result);
    }

    if (method === "DELETE") {
      const request = parseBodyObject(body);
      assertKeys(request, ["expectedVersion"]);
      const result = deleteContactWithSocials(
        key,
        nonNegativeInteger(request.expectedVersion, "expectedVersion"),
      );
      if (result.status === "deleted") {
        return {
          status: 200,
          body: {
            status: result.status,
            contact: toContactDto(result.record),
          },
        };
      }
      if (result.status === "not_found") {
        return errorResponse(404, "contact_not_found", "Contact not found");
      }
      return errorResponse(409, "contact_conflict", "Contact version conflict", result);
    }

    return errorResponse(405, "method_not_allowed", "Method not allowed");
  } catch (error) {
    if (error instanceof InvalidRequestError) {
      return errorResponse(400, "invalid_request", error.message);
    }
    if (isConstraintError(error)) {
      return errorResponse(
        409,
        "constraint_violation",
        "The contact or social record conflicts with existing data",
      );
    }
    throw error;
  }
}
