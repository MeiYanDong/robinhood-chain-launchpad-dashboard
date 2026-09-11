#!/usr/bin/env python3
"""Build a compact main database without mutating the source database.

The active monitor tables live in monitor.sqlite. Older copies of those tables can
therefore be removed from a *new* main-database copy after the sole writer has been
stopped. The source is deliberately left untouched so the operator can validate and
perform an atomic swap.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sqlite3
from typing import Iterable


MONITOR_PREFIXES = ("pair_v2_", "pair_alpha_", "dev_monitor_")


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def table_counts(connection: sqlite3.Connection, tables: Iterable[str]) -> dict[str, int]:
    return {
        table: int(
            connection.execute(
                f"SELECT COUNT(*) FROM {quote_identifier(table)}"
            ).fetchone()[0]
        )
        for table in tables
    }


def compact(source: Path, destination: Path) -> dict[str, object]:
    source = source.expanduser().resolve(strict=True)
    destination = destination.expanduser().resolve()
    if source == destination:
        raise ValueError("Source and destination must differ")
    if destination.exists():
        raise ValueError("Destination already exists; refusing to overwrite")
    destination.parent.mkdir(parents=True, exist_ok=True)

    source_connection = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    destination_connection = sqlite3.connect(destination)
    try:
        source_connection.execute("PRAGMA query_only=ON")
        source_connection.backup(destination_connection, pages=4096)
        destination_connection.commit()

        schema = destination_connection.execute(
            "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL"
        ).fetchall()
        excluded_tables = sorted(
            name
            for kind, name, _, _ in schema
            if kind == "table" and name.startswith(MONITOR_PREFIXES)
        )
        if not excluded_tables:
            raise ValueError("No legacy monitoring tables found; refusing no-op compaction")

        retained_tables = sorted(
            name
            for kind, name, _, _ in schema
            if kind == "table"
            and not name.startswith("sqlite_")
            and name not in excluded_tables
        )
        counts_before = table_counts(destination_connection, retained_tables)

        dependent_views = sorted(
            name
            for kind, name, _, sql in schema
            if kind == "view"
            and any(prefix in (sql or "").lower() for prefix in MONITOR_PREFIXES)
        )

        destination_connection.execute("PRAGMA foreign_keys=OFF")
        destination_connection.execute("BEGIN IMMEDIATE")
        for view in dependent_views:
            destination_connection.execute(f"DROP VIEW {quote_identifier(view)}")
        for table in excluded_tables:
            destination_connection.execute(f"DROP TABLE {quote_identifier(table)}")
        destination_connection.commit()

        destination_connection.execute("PRAGMA journal_mode=DELETE")
        destination_connection.execute("VACUUM")
        integrity = [
            row[0] for row in destination_connection.execute("PRAGMA quick_check").fetchall()
        ]
        if integrity != ["ok"]:
            raise ValueError(f"Integrity validation failed: {integrity[:3]}")
        foreign_key_failures = destination_connection.execute(
            "PRAGMA foreign_key_check"
        ).fetchall()
        if foreign_key_failures:
            raise ValueError(
                f"Foreign-key validation failed: {foreign_key_failures[:3]}"
            )
        counts_after = table_counts(destination_connection, retained_tables)
        if counts_before != counts_after:
            raise ValueError("Retained table row counts changed during compaction")

        os.chmod(destination, source.stat().st_mode & 0o777)
        return {
            "integrity": "ok",
            "source": str(source),
            "destination": str(destination),
            "source_bytes": source.stat().st_size,
            "destination_bytes": destination.stat().st_size,
            "removed_tables": excluded_tables,
            "removed_dependent_views": dependent_views,
            "retained_table_counts": counts_after,
            "source_retained": True,
        }
    except Exception:
        destination_connection.close()
        for suffix in ("", "-wal", "-shm"):
            Path(f"{destination}{suffix}").unlink(missing_ok=True)
        raise
    finally:
        source_connection.close()
        try:
            destination_connection.close()
        except Exception:
            pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    arguments = parser.parse_args()
    print(json.dumps(compact(arguments.source, arguments.destination), sort_keys=True))
