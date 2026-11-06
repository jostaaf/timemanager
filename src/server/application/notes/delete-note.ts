import { runInImmediateTransaction } from "../../db/client.js";
import { deleteNote } from "../../db/note.js";
import type { OptimisticDeleteResult } from "../../db/optimistic-update.js";
import type { NoteRecord } from "../../db/types.js";

export function deleteNoteWithAssignments(
  noteKey: number,
  expectedVersion: number,
): OptimisticDeleteResult<NoteRecord> {
  return runInImmediateTransaction(() =>
    deleteNote(noteKey, expectedVersion),
  );
}
