import { listContactsBySocialMedia as findContactsByMedia } from "../../db/contact-socials.js";
import type { ContactRecord } from "../../db/types.js";

export function listContactsBySocialMedia(media: string): ContactRecord[] {
  return findContactsByMedia(media);
}
