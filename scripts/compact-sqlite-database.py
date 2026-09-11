#!/usr/bin/env python3
"""Create a verified, vacuumed SQLite copy without touching the source file."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sqlite3


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


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
        tables = sorted(
            row[0]
            for row in destination_connection.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            ).fetchall()
        )
        counts_before = {
            table: int(
                destination_connection.execute(
                    f"SELECT COUNT(*) FROM {quote_identifier(table)}"
                ).fetchone()[0]
            )
            for table in tables
        }
        destination_connection.execute("PRAGMA journal_mode=DELETE")
        destination_connection.execute("VACUUM")
        if destination_connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("Integrity validation failed")
        if destination_connection.execute("PRAGMA foreign_key_check").fetchall():
            raise ValueError("Foreign-key validation failed")
        counts_after = {
            table: int(
                destination_connection.execute(
                    f"SELECT COUNT(*) FROM {quote_identifier(table)}"
                ).fetchone()[0]
            )
            for table in tables
        }
        if counts_before != counts_after:
            raise ValueError("Table row counts changed during compaction")
        os.chmod(destination, source.stat().st_mode & 0o777)
        return {
            "integrity": "ok",
            "source": str(source),
            "destination": str(destination),
            "source_bytes": source.stat().st_size,
            "destination_bytes": destination.stat().st_size,
            "table_counts": counts_after,
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
