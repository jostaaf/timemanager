#!/usr/bin/env python3
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATABASE_PATH = ROOT / "database" / "timemanager.db"
MIGRATION_PATH = ROOT / "database" / "migrations" / "003_add_notes.sql"


def main() -> None:
    if not DATABASE_PATH.is_file():
        raise FileNotFoundError(f"SQLite database not found: {DATABASE_PATH}")

    connection = sqlite3.connect(DATABASE_PATH)
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.executescript(
            "BEGIN IMMEDIATE;\n"
            + MIGRATION_PATH.read_text(encoding="utf-8")
            + "\nCOMMIT;"
        )
        violations = connection.execute("PRAGMA foreign_key_check").fetchall()
        if violations:
            raise RuntimeError(f"Foreign-key violations after migration: {violations!r}")
        print("Notes migration applied successfully")
    except Exception:
        if connection.in_transaction:
            connection.rollback()
        raise
    finally:
        connection.close()


if __name__ == "__main__":
    main()
