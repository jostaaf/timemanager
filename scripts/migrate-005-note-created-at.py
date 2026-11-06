#!/usr/bin/env python3
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATABASE_PATH = ROOT / "database" / "timemanager.db"
MIGRATION_PATH = (
    ROOT / "database" / "migrations" / "005_note_created_at_iso8601.sql"
)
SQLITE_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$")
ISO_TIMESTAMP = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"
)


def normalize_timestamp(value: str) -> str:
    if ISO_TIMESTAMP.fullmatch(value):
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ")
        return parsed.replace(tzinfo=timezone.utc).isoformat(
            timespec="milliseconds"
        ).replace("+00:00", "Z")
    if SQLITE_TIMESTAMP.fullmatch(value):
        parsed = datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
        return parsed.replace(tzinfo=timezone.utc).isoformat(
            timespec="milliseconds"
        ).replace("+00:00", "Z")
    raise ValueError(f"Unsupported note creation timestamp: {value!r}")


def main() -> None:
    if not DATABASE_PATH.is_file():
        raise FileNotFoundError(f"SQLite database not found: {DATABASE_PATH}")

    connection = sqlite3.connect(DATABASE_PATH)
    try:
        connection.execute("PRAGMA foreign_keys = OFF")
        columns = {
            row[1]: row
            for row in connection.execute('PRAGMA table_info("note")')
        }
        if not columns:
            raise RuntimeError("The note table does not exist.")

        rows = connection.execute(
            'SELECT "key", "created_at" FROM note ORDER BY "key"'
        ).fetchall()
        normalized = [
            (key, normalize_timestamp(created_at))
            for key, created_at in rows
        ]
        has_default = columns["created_at"][4] is not None
        needs_conversion = any(
            normalized_value != created_at
            for (_, created_at), (_, normalized_value) in zip(
                rows, normalized, strict=True
            )
        )
        if not has_default and not needs_conversion:
            print("Note timestamp migration already applied")
            return

        try:
            connection.executescript(
                "BEGIN IMMEDIATE;\n"
                + MIGRATION_PATH.read_text(encoding="utf-8")
            )
            migrated_rows = connection.execute(
                'SELECT "created_at" FROM note'
            ).fetchall()
            if any(
                not ISO_TIMESTAMP.fullmatch(created_at)
                for (created_at,) in migrated_rows
            ):
                raise RuntimeError(
                    "Note timestamps could not all be converted to canonical "
                    "UTC ISO-8601 format."
                )
            violations = connection.execute(
                "PRAGMA foreign_key_check"
            ).fetchall()
            if violations:
                raise RuntimeError(
                    f"Foreign-key violations after migration: {violations!r}"
                )
            connection.commit()
        except Exception:
            if connection.in_transaction:
                connection.rollback()
            raise

        connection.execute("PRAGMA foreign_keys = ON")
        print("Note timestamp migration applied successfully")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
