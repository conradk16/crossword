#!/usr/bin/env python3
"""
Generate clues for full boards across a date range and write to JSONL.

This script generates clue records and writes them (NDJSON) to
`full_board_clues.jsonl` in this directory. Use the companion script
`upload_full_board_clues.py` to upload the generated records.

Usage:
  python generate_full_board_clues.py <local|dev|prod> START_DATE END_DATE

Arguments:
  START_DATE, END_DATE: Dates in MM-DD-YYYY format (inclusive)

Environment variables (per environment):
  - CROSSWORD_ADMIN_URL_LOCAL,  CROSSWORD_ADMIN_KEY_LOCAL
  - CROSSWORD_ADMIN_URL_DEV,    CROSSWORD_ADMIN_KEY_DEV
  - CROSSWORD_ADMIN_URL_PROD,   CROSSWORD_ADMIN_KEY_PROD

Also requires:
  - OPENAI_API_KEY (and optionally OPENAI_CLUE_MODEL) for clue generation
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
from typing import Any, Dict, Iterable, List, Optional

import requests

from utils import generate_clues_for_words


DATE_REGEX = re.compile(r"^\d{2}-\d{2}-\d{4}$")

# Output file (NDJSON) written by this script
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), "full_board_clues.jsonl")


def validate_date(date_str: str) -> None:
    if not DATE_REGEX.match(date_str):
        raise ValueError("Date must be in MM-DD-YYYY format")


def parse_mmddyyyy(date_str: str) -> dt.date:
    return dt.datetime.strptime(date_str, "%m-%d-%Y").date()


def to_mmddyyyy(d: dt.date) -> str:
    return d.strftime("%m-%d-%Y")


def to_iso(d: dt.date) -> str:
    return d.isoformat()


def date_range_inclusive(start: dt.date, end: dt.date) -> Iterable[dt.date]:
    if end < start:
        raise ValueError("END_DATE must be on or after START_DATE")
    cur = start
    one_day = dt.timedelta(days=1)
    while cur <= end:
        yield cur
        cur += one_day


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


def build_ndjson_for_date(date_iso: str, words_payload: Dict[str, Any], word_to_clue: Dict[str, str]) -> str:
    lines: List[str] = []
    words: List[Dict[str, Any]] = words_payload.get("words") or []
    for w in words:
        word = w.get("word")
        direction = w.get("direction")
        x = w.get("x")  # column index
        y = w.get("y")  # row index
        if not isinstance(word, str) or not isinstance(direction, str):
            continue
        if direction not in ("across", "down"):
            continue
        if not isinstance(x, int) or not isinstance(y, int):
            continue
        clue = word_to_clue.get(word)
        if not isinstance(clue, str) or not clue.strip():
            # Skip if missing a clue for this word
            continue
        rec = {
            "date": date_iso,
            "clue": clue,
            "direction": direction,
            "row": y,
            "col": x,
        }
        lines.append(json.dumps(rec, ensure_ascii=False))
    return "\n".join(lines) + ("\n" if lines else "")


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(description="Generate clues for boards across a date range and write NDJSON to file")
    parser.add_argument("env", choices=["local", "dev", "prod"], help="Target environment")
    parser.add_argument("start", help="Start date (MM-DD-YYYY)")
    parser.add_argument("end", help="End date (MM-DD-YYYY)")
    args = parser.parse_args(argv)

    try:
        validate_date(args.start)
        validate_date(args.end)
        start_date = parse_mmddyyyy(args.start)
        end_date = parse_mmddyyyy(args.end)
    except Exception as e:
        print(f"Invalid date(s): {e}", file=sys.stderr)
        return 2

    try:
        base_url, admin_key = get_config(args.env)
    except Exception as e:
        print(str(e), file=sys.stderr)
        return 2

    total_dates = 0
    total_written_dates = 0
    total_written_records = 0

    # Open output file in write mode (overwrite existing)
    try:
        out_f = open(OUTPUT_FILE, "w", encoding="utf-8")
    except Exception as e:
        print(f"Failed to open output file {OUTPUT_FILE}: {e}", file=sys.stderr)
        return 2

    for day in date_range_inclusive(start_date, end_date):
        total_dates += 1
        mmddyyyy = to_mmddyyyy(day)
        iso_date = to_iso(day)
        print(f"Processing {mmddyyyy} ...")

        data = http_get_word_locs(base_url, admin_key, mmddyyyy)
        if data is None:
            print(f"  No puzzle exists for {mmddyyyy}; skipping.")
            continue

        words_payload = data
        words = words_payload.get("words") or []
        if not isinstance(words, list) or not words:
            print(f"  No words returned for {mmddyyyy}; skipping.")
            continue

        word_list: List[str] = []
        for w in words:
            word = w.get("word")
            if isinstance(word, str) and word.strip():
                word_list.append(word)

        if not word_list:
            print(f"  No valid words for {mmddyyyy}; skipping.")
            continue

        try:
            word_to_clue = generate_clues_for_words(word_list)
        except Exception as e:
            print(f"  Clue generation failed for {mmddyyyy}: {e}", file=sys.stderr)
            continue

        ndjson_text = build_ndjson_for_date(iso_date, words_payload, word_to_clue)
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
