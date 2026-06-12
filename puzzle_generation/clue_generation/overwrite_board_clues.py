#!/usr/bin/env python3
"""
Overwrite clues for a subset of entries specified in clues_to_overwrite.csv and upload to local database.

This script reads clue records from the input file and uploads them directly to the local database.

Usage:
  python overwrite_board_clues.py <date> [--file FILE]

The input file has no header. Each line is pipe-separated:
  row | col | direction | clue | reason

Where:
- row: row index (integer)
- col: column index (integer)
- direction: direction string: "across" or "down"
- clue: free-text clue (may contain commas)
- reason: why the original clue was overridden (optional)

Workflow: paste a line straight from the output of print_puzzle.py
(row | col | direction | clue) as-is for an override with no reason, or append
" | <reason>" to record why. Fields are pipe-delimited, so the clue is its own
field and any commas inside it are preserved automatically — no escaping needed.
Lines that don't parse (e.g. the "Date:"/"Grid:" banner from print_puzzle.py,
which has no pipes) are skipped.

Every override that includes a reason is also appended to
../clue_override_examples.txt (answer word + original clue + preferred clue +
reason) so the reasons can be fed back into clue generation. The original clue is
read from the local board before the override is applied.

Examples:
  python overwrite_board_clues.py 09-25-2025
  python overwrite_board_clues.py 09-25-2025 --file my_clues.csv

CSV example:
  0 | 0 | down | yummy yogurt
  2 | 0 | across | "Wait," she said, with a comma | original was too obscure

Notes:
- Date must be in MM-DD-YYYY format.
- Direction is "across" or "down" (case-insensitive).
- Rows with an empty clue are skipped; the reason is optional.

Environment variables:
  - CROSSWORD_ADMIN_URL_LOCAL, CROSSWORD_ADMIN_KEY_LOCAL
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import requests

# Use macOS system trust store so Python requests trusts the same CAs as curl
try:
    import truststore  # type: ignore

    truststore.inject_into_ssl()
except Exception:
    # If truststore is unavailable for any reason, continue; requests will fall back to certifi
    pass


DATE_REGEX = re.compile(r"^\d{2}-\d{2}-\d{4}$")
LOC_REGEX = re.compile(r"^\(\s*(\d+)\s*,\s*(\d+)\s*\)$")  # unused; kept for clarity in docs

# Accumulating log of human clue overrides, in the parent puzzle_generation/ dir.
# Each override appends an example (word + preferred clue + reason) that is fed
# back into clue generation by generate_full_board_clues.py.
EXAMPLES_PATH = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "clue_override_examples.txt")
)


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


def http_get_puzzle(base_url: str, admin_key: str, mmddyyyy: str, timeout: int = 30) -> Optional[Dict[str, Any]]:
    """Fetch the full puzzle (grid + clues) for a date. Returns None on 404."""
    url = f"{base_url}/api/admin/puzzles/get_by_date?date={mmddyyyy}"
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
    # Why the original clue was overridden (required, from the file)
    reason: Optional[str] = None
    # The clue currently on the board before this override (from API); set later
    original_clue: Optional[str] = None


def parse_input_file(path: str, date_str: str) -> List[InputRow]:
    """Parse the header-less input file and return a list of InputRow items for the given date.

    Each line is "row, col, direction, clue, reason". The first three commas separate
    row/col/direction, and the reason is taken from the last comma onward, so commas and
    double quotes inside the clue are preserved as-is. Lines that don't parse cleanly
    (blank lines, banners, etc.) are skipped, so output pasted straight from
    print_puzzle.py (with a reason appended) works without editing.
    """
    validate_date(date_str)
    d = parse_mmddyyyy(date_str)
    iso_date = to_iso(d)

    items: List[InputRow] = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue

            parts = [p.strip() for p in line.split("|")]
            if len(parts) < 4:
                # Not a clue row (e.g. a header/banner/grid line, which has no '|'); skip silently.
                continue

            row_str = parts[0]
            col_str = parts[1]
            dir_str = parts[2].lower()
            # Fields are pipe-delimited, so the clue is its own field and may contain commas
            # freely. The reason is the optional 5th field.
            raw_clue = parts[3]
            raw_reason = parts[4] if len(parts) >= 5 else ""

            try:
                file_row = int(row_str)
                file_col = int(col_str)
            except ValueError:
                # Likely a non-data line (e.g. grid/banner); skip silently.
                continue

            if dir_str not in ("across", "down"):
                print(f"Skipping row with invalid direction '{dir_str}' (use 'across' or 'down')")
                continue

            if not raw_clue:
                print(f"Skipping row with empty clue at (row,col)=({file_row},{file_col}) {dir_str}")
                continue

            ir = InputRow(
                mmddyyyy=date_str,
                iso_date=iso_date,
                direction=dir_str,
                file_col=file_col,
                file_row=file_row,
                provided_clue=raw_clue,
                reason=raw_reason,
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


def build_original_clue_index(puzzle_payload: Dict[str, Any]) -> Dict[Tuple[str, int, int], str]:
    """Return a map from (direction, row, col) -> existing clue text from a puzzle payload.

    The puzzle payload comes from /api/admin/puzzles/get_by_date and contains a 'clues' list
    of {clue, direction, row, col, length}, where row=y and col=x (same convention as the
    resolved row0/col0 on each InputRow).
    """
    idx: Dict[Tuple[str, int, int], str] = {}
    clues = puzzle_payload.get("clues") or []
    for c in clues:
        clue = c.get("clue")
        direction = c.get("direction")
        row = c.get("row")
        col = c.get("col")
        if not isinstance(clue, str) or not isinstance(direction, str):
            continue
        if direction not in ("across", "down"):
            continue
        if not isinstance(row, int) or not isinstance(col, int):
            continue
        idx[(direction, row, col)] = clue
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


def build_ndjson_for_items(items: List[InputRow]) -> str:
    lines: List[str] = []
    for it in items:
        if it.row0 is None or it.col0 is None:
            continue
        clue_text = it.provided_clue
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


def append_override_examples(items: List[InputRow]) -> int:
    """Append each override (word + original clue + preferred clue + reason) to EXAMPLES_PATH.

    Only items with a resolved word, a clue, and a reason are written. The original clue is
    included when available (it's best-effort additive). Returns the number of examples
    appended.
    """
    blocks: List[str] = []
    for it in items:
        if not (isinstance(it.word, str) and it.word.strip()):
            continue
        if not (isinstance(it.provided_clue, str) and it.provided_clue.strip()):
            continue
        if not (isinstance(it.reason, str) and it.reason.strip()):
            continue
        original_line = ""
        if isinstance(it.original_clue, str) and it.original_clue.strip():
            original_line = f"Original (rejected) clue: {it.original_clue.strip()}\n"
        blocks.append(
            f"Word: {it.word.strip()}\n"
            f"{original_line}"
            f"Preferred clue: {it.provided_clue.strip()}\n"
            f"Reason original was rejected: {it.reason.strip()}\n"
            "---\n"
        )

    if not blocks:
        return 0

    with open(EXAMPLES_PATH, "a", encoding="utf-8") as f:
        f.write("".join(blocks))
    return len(blocks)


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(description="Overwrite clues for specific entries listed in a file and upload to local database")
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

    # Capture each entry's existing clue from the board BEFORE the override is applied, so it
    # can be recorded alongside the preferred clue. Best-effort: a failure here must not block
    # the override itself.
    try:
        puzzle = http_get_puzzle(base_url, admin_key, mmddyyyy)
        if puzzle is None:
            print(f"Warning: no puzzle found when fetching original clues for {mmddyyyy}.", file=sys.stderr)
        else:
            clue_idx = build_original_clue_index(puzzle)
            for it in items:
                if isinstance(it.row0, int) and isinstance(it.col0, int):
                    it.original_clue = clue_idx.get((it.direction, it.row0, it.col0))
    except Exception as e:
        print(f"Warning: failed to fetch original clues for {mmddyyyy}: {e}", file=sys.stderr)

    ndjson_text = build_ndjson_for_items(items)
    if not ndjson_text.strip():
        print(f"No clue records to upload.")
        return 1

    lines = ndjson_text.strip().splitlines()
    num_records = len(lines)
    print(f"Prepared {num_records} clue record(s)")

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

    # Record each override (word + preferred clue + reason) so it can be fed back
    # into clue generation by generate_full_board_clues.py.
    try:
        appended = append_override_examples(items)
        if appended:
            print(f"Appended {appended} override example(s) to {EXAMPLES_PATH}")
    except Exception as e:
        print(f"Warning: failed to append override examples: {e}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))


