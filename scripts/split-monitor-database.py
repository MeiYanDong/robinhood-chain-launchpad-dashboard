#!/usr/bin/env python3
"""Copy monitoring tables with the writer stopped. Retain the original database unchanged."""
import argparse
import json
from pathlib import Path
import sqlite3


def split(source: Path, destination: Path):
    if destination.exists():
        raise ValueError("Destination already exists; refusing to overwrite")
    source = source.resolve(strict=True)
    src = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    dst = sqlite3.connect(destination)
    try:
        schema = src.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL").fetchall()
        tables = {name for kind, name, _, _ in schema if kind == "table" and
                  name.startswith(("pair_v2_", "pair_alpha_", "dev_monitor_")) and
                  name != "pair_v2_dashboard_snapshots"}
        if not tables:
            raise ValueError("Source has no monitoring tables")
        # One consistent source transaction; operator must stop the sole writer.
        src.execute("BEGIN")
        dst.execute("BEGIN")
        counts = {}
        for kind, name, _, sql in schema:
            if kind != "table" or name not in tables:
                continue
            dst.execute(sql)
            columns = [row[1] for row in src.execute(f'PRAGMA table_info("{name}")')]
            projection = ",".join("'{}'" if name == "pair_v2_token_snapshots" and column == "payload_json" else f'"{column}"' for column in columns)
            cursor = src.execute(f'SELECT {projection} FROM "{name}"')
            placeholders = ",".join("?" for _ in cursor.description)
            count = 0
            while rows := cursor.fetchmany(500):
                dst.executemany(f'INSERT INTO "{name}" VALUES ({placeholders})', rows)
                count += len(rows)
            assert dst.execute(f'SELECT count(*) FROM "{name}"').fetchone()[0] == count
            counts[name] = count
        for kind, _, table, sql in schema:
            if kind == "index" and table in tables:
                dst.execute(sql)
        if dst.execute("PRAGMA foreign_key_check").fetchall():
            raise ValueError("Foreign key validation failed")
        dst.commit()
        if dst.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("Integrity validation failed")
        print(json.dumps({"integrity": "ok", "tables": counts, "original_retained": True}))
    except Exception:
        dst.rollback()
        dst.close()
        destination.unlink(missing_ok=True)
        raise
    finally:
        src.close()
        dst.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    split(args.source, args.destination)
