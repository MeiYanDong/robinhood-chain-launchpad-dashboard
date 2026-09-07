#!/usr/bin/env python3
"""Rollback bridge, with all writers stopped; preserve original full history JSON."""
import argparse
import sqlite3
import json
from pathlib import Path


def restore(monitor: Path, original: Path):
    src = sqlite3.connect(f"file:{monitor.resolve(strict=True)}?mode=ro", uri=True)
    dst = sqlite3.connect(original.resolve(strict=True))
    try:
        src.execute("BEGIN")
        schema = src.execute("SELECT name,sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL AND name != 'sqlite_sequence'").fetchall()
        dst.execute("BEGIN IMMEDIATE")
        copied = {}
        for name, sql in schema:
            if not name.startswith(("pair_v2_", "pair_alpha_", "dev_monitor_")) or name == "pair_v2_dashboard_snapshots":
                continue
            if not dst.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone():
                dst.execute(sql)
            columns = [row[1] for row in src.execute(f'PRAGMA table_info("{name}")')]
            destination_columns = {row[1] for row in dst.execute(f'PRAGMA table_info("{name}")')}
            if not set(columns) <= destination_columns:
                raise ValueError("Rollback schema mismatch")
            cursor = src.execute(f'SELECT * FROM "{name}"')
            placeholders = ",".join("?" for _ in columns)
            names = ",".join(f'"{column}"' for column in columns)
            # Existing historical payloads are richer; new runs are added.
            policy = "IGNORE" if name == "pair_v2_token_snapshots" else "REPLACE"
            count = 0
            while rows := cursor.fetchmany(500):
                dst.executemany(f'INSERT OR {policy} INTO "{name}" ({names}) VALUES ({placeholders})', rows)
                count += len(rows)
            copied[name] = count
        if dst.execute("PRAGMA foreign_key_check").fetchall():
            raise ValueError("Rollback foreign key validation failed")
        dst.commit()
        print(json.dumps({"restored": copied, "legacy_history_preserved": True}))
    except Exception:
        dst.rollback()
        raise
    finally:
        src.close()
        dst.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("monitor", type=Path)
    parser.add_argument("original", type=Path)
    args = parser.parse_args()
    restore(args.monitor, args.original)
