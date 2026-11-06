#!/usr/bin/env python3
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATABASE_PATH = ROOT / "database" / "timemanager.db"
MIGRATION_PATH = (
    ROOT / "database" / "migrations" / "002_add_relationship_foreign_keys.sql"
)


def main() -> None:
    if not DATABASE_PATH.is_file():
        raise FileNotFoundError(f"SQLite database not found: {DATABASE_PATH}")

    connection = sqlite3.connect(DATABASE_PATH)
    try:
        event_columns = {
            row[1] for row in connection.execute('PRAGMA table_info("event_contacts")')
        }
        if "event_key" in event_columns:
            print("Relationship migration already applied")
            return

        link_count = connection.execute(
            "SELECT count(*) FROM event_contacts"
        ).fetchone()[0]
        if link_count:
            raise RuntimeError(
                "Cannot migrate event_contacts: existing rows have no event_key. "
                "Assign each row to an event before applying this migration."
            )

        foreign_key_violations = connection.execute(
            """
            SELECT count(*)
            FROM contact_socials AS social
            LEFT JOIN contact ON contact."key" = social.contact_key
            WHERE contact."key" IS NULL
            """
        ).fetchone()[0]
        if foreign_key_violations:
            raise RuntimeError(
                "Cannot migrate contact_socials: some rows refer to missing contacts."
            )

        connection.execute("PRAGMA foreign_keys = ON")
        try:
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
        except Exception:
            connection.rollback()
            raise

        print("Relationship migration applied successfully")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
