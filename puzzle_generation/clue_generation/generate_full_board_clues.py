#!/usr/bin/env python3
"""
Generate clues for a single board date and upload to local environment.

This script generates clue records and uploads them directly to the local API.

Usage:
  python generate_full_board_clues.py DATE

Arguments:
  DATE: Date in MM-DD-YYYY format

Environment variables:
  - CROSSWORD_ADMIN_URL_LOCAL
  - CROSSWORD_ADMIN_KEY_LOCAL

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
from typing import Any, Dict, List, Optional

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


def http_post_bulk_clues(base_url: str, admin_key: str, ndjson_text: str, timeout: int = 60) -> Dict[str, Any]:
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
    parser = argparse.ArgumentParser(description="Generate clues for a single board date and write NDJSON to file")
    parser.add_argument("date", help="Date (MM-DD-YYYY)")
    args = parser.parse_args(argv)

    try:
        validate_date(args.date)
        target_date = parse_mmddyyyy(args.date)
    except Exception as e:
        print(f"Invalid date: {e}", file=sys.stderr)
        return 2

    try:
        base_url, admin_key = get_config("local")
    except Exception as e:
        print(str(e), file=sys.stderr)
        return 2

    mmddyyyy = to_mmddyyyy(target_date)
    iso_date = to_iso(target_date)
    print(f"Processing {mmddyyyy} ...")

    data = http_get_word_locs(base_url, admin_key, mmddyyyy)
    if data is None:
        print(f"No puzzle exists for {mmddyyyy}")
        return 1

    words_payload = data
    words = words_payload.get("words") or []
    if not isinstance(words, list) or not words:
        print(f"No words returned for {mmddyyyy}")
        return 1

    word_list: List[str] = []
    for w in words:
        word = w.get("word")
        if isinstance(word, str) and word.strip():
            word_list.append(word)

    if not word_list:
        print(f"No valid words for {mmddyyyy}")
        return 1

    try:
        word_to_clue = generate_clues_for_words(word_list)
    except Exception as e:
        print(f"Clue generation failed for {mmddyyyy}: {e}", file=sys.stderr)
        return 1

    ndjson_text = build_ndjson_for_date(iso_date, words_payload, word_to_clue)
    if not ndjson_text.strip():
        print(f"No clue records to upload for {mmddyyyy}")
        return 1

    num_records = len(ndjson_text.strip().splitlines())
    print(f"Uploading {num_records} clue record(s) ...")

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
