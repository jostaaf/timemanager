import { runInImmediateTransaction } from "../../db/client.js";
import { deleteEvent } from "../../db/event.js";
import type { OptimisticDeleteResult } from "../../db/optimistic-update.js";
import type { EventRecord } from "../../db/types.js";

export function deleteEventWithContacts(
  eventKey: number,
  expectedVersion: number,
): OptimisticDeleteResult<EventRecord> {
  return runInImmediateTransaction(() =>
    deleteEvent(eventKey, expectedVersion),
  );
}
