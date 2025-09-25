#!/usr/bin/env python3
"""
Generate clues for a subset of entries specified in clues_to_overwrite.csv and write to JSONL.

This script generates clue records and writes them (NDJSON) to
`partial_board_clues.jsonl` in this directory. Use the companion script
`upload_partial_board_clues.py` to upload the generated records.

Usage:
  python generate_partial_board_clues.py <local|dev|prod> [--file FILE]

The input file must be a CSV with header:
  date, row, col, direction, optional_clue

Where:
- date: MM-DD-YYYY
- row: row index (integer)
- col: column index (integer)
- direction: direction string: "across" or "down"
- optional_clue: optional free-text clue; if empty, a clue will be generated

Examples:
  09-25-2025, 2, 0, across,
  09-25-2025, 0, 0, down, yummy yogurt

Notes:
- Direction is "across" or "down" (case-insensitive).
- If optional_clue is non-empty, it will be used as-is; otherwise a clue will be
  generated with OpenAI via utils.generate_clues_for_words using the suffix
  "We'll just do one word, actually".

Environment variables (per environment):
  - CROSSWORD_ADMIN_URL_LOCAL,  CROSSWORD_ADMIN_KEY_LOCAL
  - CROSSWORD_ADMIN_URL_DEV,    CROSSWORD_ADMIN_KEY_DEV
  - CROSSWORD_ADMIN_URL_PROD,   CROSSWORD_ADMIN_KEY_PROD

Also requires:
  - OPENAI_API_KEY (and optionally OPENAI_CLUE_MODEL) for clue generation
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import os
import re
import sys
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests

from utils import generate_clues_for_words


DATE_REGEX = re.compile(r"^\d{2}-\d{2}-\d{4}$")
LOC_REGEX = re.compile(r"^\(\s*(\d+)\s*,\s*(\d+)\s*\)$")  # unused; kept for clarity in docs

# Output file (NDJSON) written by this script
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), "partial_board_clues.jsonl")


def validate_date(date_str: str) -> None:
    if not DATE_REGEX.match(date_str):
        raise ValueError("Date must be in MM-DD-YYYY format")


def parse_mmddyyyy(date_str: str) -> dt.date:
    return dt.datetime.strptime(date_str, "%m-%d-%Y").date()


def to_mmddyyyy(d: dt.date) -> str:
    return d.strftime("%m-%d-%Y")


def to_iso(d: dt.date) -> str:
    return d.isoformat()


def get_config(env: str) -> tuple[str, str]:
    env_upper = {"local": "LOCAL", "dev": "DEV", "prod": "PROD"}.get(env)
    if env_upper is None:
        raise RuntimeError("Invalid --env; expected one of: local, dev, prod")
    url_var = f"CROSSWORD_ADMIN_URL_{env_upper}"
    key_var = f"CROSSWORD_ADMIN_KEY_{env_upper}"
    base_url = os.environ.get(url_var)
    admin_key = os.environ.get(key_var)
    if not base_url:
        raise RuntimeError(f"Missing environment variable {url_var}")
    if not admin_key:
        raise RuntimeError(f"Missing environment variable {key_var}")
    return base_url.rstrip("/"), admin_key


def http_get_word_locs(base_url: str, admin_key: str, mmddyyyy: str, timeout: int = 30) -> Optional[Dict[str, Any]]:
    url = f"{base_url}/api/admin/boards/get_word_locs_by_date?date={mmddyyyy}"
    headers = {"x-admin-secret": admin_key, "Accept": "application/json"}
    resp = requests.get(url, headers=headers, timeout=timeout)
    if resp.status_code == 404:
        return None
    if resp.status_code >= 400:
        raise RuntimeError(f"GET {url} failed: {resp.status_code} {resp.text}")
    return resp.json()


# Note: Uploading is now handled by `upload_partial_board_clues.py`


@dataclass
class InputRow:
    mmddyyyy: str
    iso_date: str
    direction: str  # 'across' | 'down'
    # Values parsed from file (col,row) as provided
    file_col: int
    file_row: int
    # Matched 0-based coordinates against the board (from API); set later
    row0: Optional[int] = None
    col0: Optional[int] = None
    # The answer word at that start (from API); set later
    word: Optional[str] = None
    # If provided in file, use as-is
    provided_clue: Optional[str] = None


def parse_input_file(path: str) -> Dict[str, List[InputRow]]:
    by_date: Dict[str, List[InputRow]] = {}
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(
            f,
            skipinitialspace=True,
            escapechar="\\",
        )
        expected = ["date", "row", "col", "direction", "optional_clue"]
        for req in expected:
            if req not in (reader.fieldnames or []):
                raise RuntimeError(
                    f"Input file missing required column '{req}'. Columns found: {reader.fieldnames}"
                )

        for row in reader:
            raw_date = (row.get("date") or "").strip()
            row_str = (row.get("row") or "").strip()
            col_str = (row.get("col") or "").strip()
            dir_str = (row.get("direction") or "").strip().lower()
            raw_clue = row.get("optional_clue")
            if raw_clue is not None:
                raw_clue = raw_clue.strip()

            if not raw_date:
                print("Skipping row with empty date")
                continue
            try:
                validate_date(raw_date)
            except Exception as e:
                print(f"Skipping row with invalid date '{raw_date}': {e}")
                continue

            if dir_str not in ("across", "down"):
                print(f"Skipping row with invalid direction '{dir_str}' (use 'across' or 'down')")
                continue

            try:
                file_row = int(row_str)
                file_col = int(col_str)
            except ValueError:
                print(f"Skipping row with non-integer row/col values row='{row_str}', col='{col_str}'")
                continue

            d = parse_mmddyyyy(raw_date)
            ir = InputRow(
                mmddyyyy=raw_date,
                iso_date=to_iso(d),
                direction=dir_str,
                file_col=file_col,
                file_row=file_row,
                provided_clue=(raw_clue if raw_clue else None),
            )
            by_date.setdefault(raw_date, []).append(ir)
    return by_date


def build_loc_index(words_payload: Dict[str, Any]) -> Dict[Tuple[str, int, int], Dict[str, Any]]:
    """Return a map from (direction, row, col) -> word-record dict using 0-based coordinates."""
    idx: Dict[Tuple[str, int, int], Dict[str, Any]] = {}
    words = words_payload.get("words") or []
    for w in words:
        word = w.get("word")
        direction = w.get("direction")
        x = w.get("x")
        y = w.get("y")
        if not isinstance(word, str) or not isinstance(direction, str):
            continue
        if direction not in ("across", "down"):
            continue
        if not isinstance(x, int) or not isinstance(y, int):
            continue
        idx[(direction, y, x)] = w
    return idx


def resolve_row_col_for_item(item: InputRow, idx: Dict[Tuple[str, int, int], Dict[str, Any]]) -> bool:
    """Populate item.row0, item.col0, item.word by matching 0-based file loc to board starts."""
    key = (item.direction, item.file_row, item.file_col)
    rec = idx.get(key)
    if rec is None:
        return False
    item.row0 = rec.get("y")
    item.col0 = rec.get("x")
    item.word = rec.get("word")
    return isinstance(item.row0, int) and isinstance(item.col0, int) and isinstance(item.word, str)


def build_ndjson_for_items(items: List[InputRow], word_to_clue: Dict[str, str]) -> str:
    lines: List[str] = []
    for it in items:
        if it.row0 is None or it.col0 is None:
            continue
        clue_text = it.provided_clue if (isinstance(it.provided_clue, str) and it.provided_clue.strip()) else None
        if clue_text is None:
            if isinstance(it.word, str) and it.word in word_to_clue:
                clue_text = word_to_clue[it.word]
        if not isinstance(clue_text, str) or not clue_text.strip():
            continue
        rec = {
            "date": it.iso_date,
            "clue": clue_text,
            "direction": it.direction,
            "row": it.row0,
            "col": it.col0,
        }
        lines.append(json.dumps(rec, ensure_ascii=False))
    return "\n".join(lines) + ("\n" if lines else "")


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(description="Generate clues for specific entries listed in a file and write NDJSON to file")
    parser.add_argument("env", choices=["local", "dev", "prod"], help="Target environment")
    parser.add_argument("--file", default="clues_to_overwrite.csv", help="Path to the input CSV file")
    args = parser.parse_args(argv)

    try:
        base_url, admin_key = get_config(args.env)
    except Exception as e:
        print(str(e), file=sys.stderr)
        return 2

    try:
        by_date = parse_input_file(args.file)
    except Exception as e:
        print(f"Failed to parse input file: {e}", file=sys.stderr)
        return 2

    if not by_date:
        print("No valid rows found in input file; nothing to do.")
        return 0

    total_dates = 0
    total_written_dates = 0
    total_written_records = 0

    # Open output file in write mode (overwrite existing)
    try:
        out_f = open(OUTPUT_FILE, "w", encoding="utf-8")
    except Exception as e:
        print(f"Failed to open output file {OUTPUT_FILE}: {e}", file=sys.stderr)
        return 2

    for mmddyyyy, items in by_date.items():
        total_dates += 1
        print(f"Processing {mmddyyyy} ...")

        # Fetch word locations for the date to resolve coordinates and words
        try:
            payload = http_get_word_locs(base_url, admin_key, mmddyyyy)
        except Exception as e:
            print(f"  Failed to load word locations for {mmddyyyy}: {e}", file=sys.stderr)
            continue

        if payload is None:
            print(f"  No puzzle exists for {mmddyyyy}; skipping.")
            continue

        idx = build_loc_index(payload)

        # Resolve each item to row0/col0/word
        unresolved: List[InputRow] = []
        for it in items:
            ok = resolve_row_col_for_item(it, idx)
            if not ok:
                unresolved.append(it)
        if unresolved:
            for it in unresolved:
                print(
                    f"  Could not resolve location {it.direction} @ file (col,row)=({it.file_col},{it.file_row}); skipping this item.",
                    file=sys.stderr,
                )
            # Filter out unresolved before proceeding
            items = [it for it in items if it not in unresolved]

        if not items:
            print(f"  No resolvable items for {mmddyyyy}; skipping.")
            continue

        # Collect words needing generation
        words_to_generate: List[str] = []
        for it in items:
            if isinstance(it.provided_clue, str) and it.provided_clue.strip():
                continue
            if isinstance(it.word, str) and it.word.strip():
                words_to_generate.append(it.word)

        word_to_clue: Dict[str, str] = {}
        if words_to_generate:
            try:
                word_to_clue = generate_clues_for_words(
                    words_to_generate,
                    prompt_suffix="We'll just do one word, actually",
                )
            except Exception as e:
                print(f"  Clue generation failed for {mmddyyyy}: {e}", file=sys.stderr)
                # We can still proceed for those with provided clues

        ndjson_text = build_ndjson_for_items(items, word_to_clue)
        if not ndjson_text.strip():
            print(f"  No clue records to write for {mmddyyyy}; skipping.")
            continue

        try:
            out_f.write(ndjson_text)
        except Exception as e:
            print(f"  Failed writing records for {mmddyyyy}: {e}", file=sys.stderr)
            continue

        num_records = len(ndjson_text.strip().splitlines())
        total_written_dates += 1
        total_written_records += num_records
        print(f"  Wrote {num_records} clue record(s)")

    try:
        out_f.close()
    except Exception:
        pass

    print(
        f"Done. Processed {total_dates} date(s). Wrote {total_written_records} record(s) across {total_written_dates} date(s) to {OUTPUT_FILE}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))


