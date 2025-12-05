#!/usr/bin/env python3
"""
Generate clues for a subset of entries specified in clues_to_overwrite.csv and upload to local database.

This script generates clue records and uploads them directly to the local database.

Usage:
  python generate_partial_board_clues.py <date> [--file FILE]

The input file must be a CSV with header:
  row, col, direction, clue

Where:
- row: row index (integer)
- col: column index (integer)
- direction: direction string: "across" or "down"
- clue: free-text clue; if empty, clue will be generated

Examples:
  python generate_partial_board_clues.py 09-25-2025
  python generate_partial_board_clues.py 09-25-2025 --file my_clues.csv

CSV example:
  2, 0, across,
  0, 0, down, yummy yogurt

Notes:
- Date must be in MM-DD-YYYY format.
- Direction is "across" or "down" (case-insensitive).
- If clue is non-empty, it will be used as-is; otherwise a clue will be
  generated with OpenAI via utils.generate_clues_for_words using the suffix
  "We'll just do one word, actually".

Environment variables:
  - CROSSWORD_ADMIN_URL_LOCAL, CROSSWORD_ADMIN_KEY_LOCAL

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

# Use macOS system trust store so Python requests trusts the same CAs as curl
try:
    import truststore  # type: ignore

    truststore.inject_into_ssl()
except Exception:
    # If truststore is unavailable for any reason, continue; requests will fall back to certifi
    pass


DATE_REGEX = re.compile(r"^\d{2}-\d{2}-\d{4}$")
LOC_REGEX = re.compile(r"^\(\s*(\d+)\s*,\s*(\d+)\s*\)$")  # unused; kept for clarity in docs


def validate_date(date_str: str) -> None:
    if not DATE_REGEX.match(date_str):
        raise ValueError("Date must be in MM-DD-YYYY format")


def parse_mmddyyyy(date_str: str) -> dt.date:
    return dt.datetime.strptime(date_str, "%m-%d-%Y").date()


def to_mmddyyyy(d: dt.date) -> str:
    return d.strftime("%m-%d-%Y")


def to_iso(d: dt.date) -> str:
    return d.isoformat()


def get_config() -> tuple[str, str]:
    """Get local environment configuration."""
    url_var = "CROSSWORD_ADMIN_URL_LOCAL"
    key_var = "CROSSWORD_ADMIN_KEY_LOCAL"
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


def http_post_bulk_clues(base_url: str, admin_key: str, ndjson_text: str, timeout: int = 60) -> Dict[str, Any]:
    """Upload clues in bulk via the admin API."""
    url = f"{base_url}/api/admin/clues/bulk_upload"
    headers = {
        "x-admin-secret": admin_key,
        "Content-Type": "text/plain",
        "Accept": "application/json",
    }
    resp = requests.post(url, data=ndjson_text.encode("utf-8"), headers=headers, timeout=timeout)
    if resp.status_code >= 400:
        raise RuntimeError(f"POST {url} failed: {resp.status_code} {resp.text}")
    return resp.json()


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


def parse_input_file(path: str, date_str: str) -> List[InputRow]:
    """Parse the CSV file and return a list of InputRow items for the given date."""
    validate_date(date_str)
    d = parse_mmddyyyy(date_str)
    iso_date = to_iso(d)
    
    items: List[InputRow] = []
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(
            f,
            skipinitialspace=True,
            escapechar="\\",
        )
        expected = ["row", "col", "direction", "clue"]
        for req in expected:
            if req not in (reader.fieldnames or []):
                raise RuntimeError(
                    f"Input file missing required column '{req}'. Columns found: {reader.fieldnames}"
                )

        for row in reader:
            row_str = (row.get("row") or "").strip()
            col_str = (row.get("col") or "").strip()
            dir_str = (row.get("direction") or "").strip().lower()
            raw_clue = row.get("clue")
            if raw_clue is not None:
                raw_clue = raw_clue.strip()

            if dir_str not in ("across", "down"):
                print(f"Skipping row with invalid direction '{dir_str}' (use 'across' or 'down')")
                continue

            try:
                file_row = int(row_str)
                file_col = int(col_str)
            except ValueError:
                print(f"Skipping row with non-integer row/col values row='{row_str}', col='{col_str}'")
                continue

            ir = InputRow(
                mmddyyyy=date_str,
                iso_date=iso_date,
                direction=dir_str,
                file_col=file_col,
                file_row=file_row,
                provided_clue=(raw_clue if raw_clue else None),
            )
            items.append(ir)
    return items


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
    parser = argparse.ArgumentParser(description="Generate clues for specific entries listed in a file and upload to local database")
    parser.add_argument("date", help="Date in MM-DD-YYYY format")
    parser.add_argument("--file", default="clues_to_overwrite.csv", help="Path to the input CSV file")
    args = parser.parse_args(argv)

    try:
        base_url, admin_key = get_config()
    except Exception as e:
        print(str(e), file=sys.stderr)
        return 2

    # Validate date format
    try:
        validate_date(args.date)
        mmddyyyy = args.date
    except Exception as e:
        print(f"Invalid date format: {e}", file=sys.stderr)
        return 2

    # Parse input file
    try:
        items = parse_input_file(args.file, mmddyyyy)
    except Exception as e:
        print(f"Failed to parse input file: {e}", file=sys.stderr)
        return 2

    if not items:
        print("No valid rows found in input file; nothing to do.")
        return 0

    print(f"Processing {mmddyyyy} with {len(items)} item(s) ...")

    # Fetch word locations for the date to resolve coordinates and words
    try:
        payload = http_get_word_locs(base_url, admin_key, mmddyyyy)
    except Exception as e:
        print(f"Failed to load word locations for {mmddyyyy}: {e}", file=sys.stderr)
        return 1

    if payload is None:
        print(f"No puzzle exists for {mmddyyyy}.")
        return 1

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
        print(f"No resolvable items for {mmddyyyy}.")
        return 1

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
            print(f"Clue generation failed: {e}", file=sys.stderr)
            # We can still proceed for those with provided clues

    ndjson_text = build_ndjson_for_items(items, word_to_clue)
    if not ndjson_text.strip():
        print(f"No clue records generated.")
        return 1

    lines = ndjson_text.strip().splitlines()
    num_records = len(lines)
    print(f"Generated {num_records} clue record(s)")

    # Upload the generated clues to the database
    print(f"\nUploading {num_records} clue(s) to database ...")

    try:
        result = http_post_bulk_clues(base_url, admin_key, ndjson_text)
    except Exception as e:
        print(f"Bulk upload failed: {e}", file=sys.stderr)
        return 1

    updated_dates = int(result.get("updated_dates", 0))
    updated_clues = int(result.get("updated_clues", 0))
    print(f"Upload complete: updated_dates={updated_dates}, updated_clues={updated_clues}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))


