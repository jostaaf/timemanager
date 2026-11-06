#!/usr/bin/env python3
import os
import re
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "database" / "schema.sql"
DATABASE_PATH = Path(
    os.environ.get(
        "TIMEMANAGER_DB_PATH",
        str(ROOT / "database" / "timemanager.db"),
    )
).resolve()


def schema_objects(connection: sqlite3.Connection) -> list[tuple[str, str, str]]:
    return connection.execute(
        """
        SELECT type, name, sql
        FROM sqlite_master
        WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
        ORDER BY type, name
        """
    ).fetchall()


def normalize_sql(sql: str) -> str:
    sql = re.sub(r'"((?:[^"]|"")*)"', lambda match: match.group(1).lower(), sql)
    sql = re.sub(r"\s+", " ", sql).strip().lower()
    return re.sub(r"\s*([(),;])\s*", r"\1", sql)


def main() -> None:
    if not SCHEMA_PATH.is_file():
        raise FileNotFoundError(f"Schema baseline not found: {SCHEMA_PATH}")

    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
    expected = sqlite3.connect(":memory:")
    try:
        expected.executescript(schema_sql)
        expected_schema = [
            (kind, name, normalize_sql(sql))
            for kind, name, sql in schema_objects(expected)
        ]
    finally:
        expected.close()

    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH)
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        existing_schema = [
            (kind, name, normalize_sql(sql))
            for kind, name, sql in schema_objects(connection)
        ]
        if not existing_schema:
            try:
                connection.executescript(
                    "BEGIN IMMEDIATE;\n" + schema_sql + "\nCOMMIT;"
                )
            except Exception:
                connection.rollback()
                raise
            print(f"Initialized database from {SCHEMA_PATH}: {DATABASE_PATH}")
        elif existing_schema != expected_schema:
            raise RuntimeError(
                f"Database schema does not match {SCHEMA_PATH}: {DATABASE_PATH}. "
                "The initializer will not modify an existing database."
            )
        else:
            print(f"Database already matches schema baseline: {DATABASE_PATH}")

        violations = connection.execute("PRAGMA foreign_key_check").fetchall()
        if violations:
            raise RuntimeError(
                f"Foreign-key violations found in {DATABASE_PATH}: {violations}"
            )
    finally:
        connection.close()


if __name__ == "__main__":
    main()
