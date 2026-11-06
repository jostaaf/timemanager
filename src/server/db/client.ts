import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";

const databasePath =
  process.env.TIMEMANAGER_DB_PATH ??
  fileURLToPath(new URL("../../../database/timemanager.db", import.meta.url));

export const db = new Database(databasePath);
db.pragma("foreign_keys = ON");

export function runInImmediateTransaction<T>(operation: () => T): T {
  return db.transaction(operation).immediate();
}
