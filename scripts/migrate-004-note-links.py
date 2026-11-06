#!/usr/bin/env python3
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATABASE_PATH = ROOT / "database" / "timemanager.db"
MIGRATION_PATH = ROOT / "database" / "migrations" / "004_normalize_note_links.sql"


def main() -> None:
    if not DATABASE_PATH.is_file():
        raise FileNotFoundError(f"SQLite database not found: {DATABASE_PATH}")

    connection = sqlite3.connect(DATABASE_PATH)
    try:
        note_columns = {
            row[1] for row in connection.execute('PRAGMA table_info("note")')
        }
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        if (
            "event_key" not in note_columns
            and "contact_key" not in note_columns
            and {"note_contacts", "note_events"} <= tables
        ):
            print("Note-link migration already applied")
            return
        if not {"event_key", "contact_key"} <= note_columns:
            raise RuntimeError(
                "The note table does not have the expected legacy assignment columns."
            )

        connection.execute("PRAGMA foreign_keys = ON")
        connection.executescript(
            "BEGIN IMMEDIATE;\n"
            + MIGRATION_PATH.read_text(encoding="utf-8")
        )
        violations = connection.execute("PRAGMA foreign_key_check").fetchall()
        if violations:
            raise RuntimeError(
                f"Foreign-key violations after migration: {violations!r}"
            )
        connection.commit()
        print("Note-link migration applied successfully")
    except Exception:
        if connection.in_transaction:
            connection.rollback()
        raise
    finally:
        connection.close()


if __name__ == "__main__":
    main()
