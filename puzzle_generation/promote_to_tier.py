#!/usr/bin/env python3
"""
Promote local puzzles to a target tier (dev or prod).

For each date in the inclusive range [start_date, end_date]:
  1) Fetch the puzzle from the local Next.js admin endpoint:
       GET /api/admin/puzzles/get_by_date?date=MM-DD-YYYY
     with header: x-admin-secret: <SOURCE_ADMIN_SECRET>

  2) Upload the board to the target tier via NDJSON:
       POST /api/admin/boards/bulk_upload
       body per line: {"date":"YYYY-MM-DD","board":(string|null)[][]}

  3) Upload the clues to the target tier via NDJSON:
       POST /api/admin/clues/bulk_upload
       body per line: {"date":"YYYY-MM-DD","clue":string,"direction":"across"|"down","row":number,"col":number}

Authentication
  - Uses header x-admin-secret on all admin endpoints.
  - Admin URLs and secrets can be provided via env:
      CROSSWORD_ADMIN_URL_LOCAL, CROSSWORD_ADMIN_URL_DEV, CROSSWORD_ADMIN_URL_PROD
      CROSSWORD_ADMIN_KEY_LOCAL, CROSSWORD_ADMIN_KEY_DEV, CROSSWORD_ADMIN_KEY_PROD
    Or via flags: --src-base-url, --src-admin-secret, --dest-admin-secret
    Fallback for secrets: CROSSWORD_ADMIN_KEY

Usage
  python promote_to_tier.py <tier> <start_mm_dd_yyyy> <end_mm_dd_yyyy> [--src-base-url URL] [--dry-run]

Examples
  python promote_to_tier.py dev 10-01-2025 10-07-2025
  python promote_to_tier.py prod 10-01-2025 10-01-2025 --dry-run
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from typing import Dict, Iterable, List, Optional, Tuple, TypedDict

import requests

# Use macOS system trust store so Python requests trusts the same CAs as curl
try:
    import truststore  # type: ignore
    truststore.inject_into_ssl()
except Exception:
    pass

def env_admin_url(name: str, default: Optional[str] = None) -> Optional[str]:
    return os.environ.get(name, default)


def env_admin_key(name: str, default: Optional[str] = None) -> Optional[str]:
    return os.environ.get(name, default)


DEFAULT_SOURCE_BASE_URL = env_admin_url("CROSSWORD_ADMIN_URL_LOCAL", "http://localhost:3000") or "http://localhost:3000"

def dest_base_url_for_tier(tier: str) -> str:
    if tier == "dev":
        return env_admin_url("CROSSWORD_ADMIN_URL_DEV", "https://conradscrossword.dev") or "https://conradscrossword.dev"
    if tier == "prod":
        return env_admin_url("CROSSWORD_ADMIN_URL_PROD", "https://conradscrossword.com") or "https://conradscrossword.com"
    raise SystemExit(f"Unknown tier: {tier}")


class Clue(TypedDict):
    clue: str
    direction: str  # 'across' | 'down'
    row: int
    col: int
    length: int


class PuzzleData(TypedDict):
    date: str  # YYYY-MM-DD
    grid: List[List[Optional[str]]]
    clues: List[Clue]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Promote local puzzles to a target tier.")
    parser.add_argument("tier", choices=["dev", "prod"], help="Target tier to promote to")
    parser.add_argument("start_date", help="Start date (MM-DD-YYYY)")
    parser.add_argument("end_date", help="End date (MM-DD-YYYY)")
    parser.add_argument("--src-base-url", default=DEFAULT_SOURCE_BASE_URL, help="Source base URL (default: %(default)s)")
    parser.add_argument("--src-admin-secret", default=(env_admin_key("CROSSWORD_ADMIN_KEY_LOCAL") or os.environ.get("CROSSWORD_SOURCE_ADMIN_KEY")), help="Admin secret for source (env CROSSWORD_ADMIN_KEY_LOCAL or CROSSWORD_SOURCE_ADMIN_KEY or CROSSWORD_ADMIN_KEY)")
    parser.add_argument("--dest-admin-secret", default=None, help="Admin secret for destination (env CROSSWORD_ADMIN_KEY_DEV/PROD or CROSSWORD_DEST_ADMIN_KEY or CROSSWORD_ADMIN_KEY)")
    parser.add_argument("--admin-secret", default=os.environ.get("CROSSWORD_ADMIN_KEY"), help="Fallback admin secret for both source and destination if specific ones are not set (env CROSSWORD_ADMIN_KEY)")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be uploaded without making requests")
    parser.add_argument("--timeout", type=float, default=30.0, help="HTTP timeout seconds (default: %(default)s)")
    return parser.parse_args()


def require_admin_secret(src_secret: Optional[str], dest_secret: Optional[str], fallback: Optional[str], tier: str) -> Tuple[str, str]:
    # Resolve destination secret by tier env if not provided
    tier_env_key = None
    if tier == "dev":
        tier_env_key = env_admin_key("CROSSWORD_ADMIN_KEY_DEV")
    elif tier == "prod":
        tier_env_key = env_admin_key("CROSSWORD_ADMIN_KEY_PROD")

    source_secret = src_secret or env_admin_key("CROSSWORD_ADMIN_KEY_LOCAL") or fallback
    dest_secret = dest_secret or tier_env_key or os.environ.get("CROSSWORD_DEST_ADMIN_KEY") or fallback
    if not source_secret:
        raise SystemExit("Missing source admin secret. Provide --src-admin-secret or set CROSSWORD_SOURCE_ADMIN_KEY/CROSSWORD_ADMIN_KEY")
    if not dest_secret:
        raise SystemExit("Missing destination admin secret. Provide --dest-admin-secret or set CROSSWORD_ADMIN_KEY_DEV/PROD or CROSSWORD_DEST_ADMIN_KEY/CROSSWORD_ADMIN_KEY")
    return source_secret, dest_secret


def parse_ymd(date_str: str) -> dt.date:
    try:
        return dt.datetime.strptime(date_str, "%m-%d-%Y").date()
    except ValueError as exc:
        raise SystemExit(f"Invalid date '{date_str}'. Use MM-DD-YYYY.") from exc


def date_range_inclusive(start_date: dt.date, end_date: dt.date) -> Iterable[dt.date]:
    if end_date < start_date:
        raise SystemExit("end_date must be >= start_date")
    num_days = (end_date - start_date).days + 1
    for i in range(num_days):
        yield start_date + dt.timedelta(days=i)


def ymd_to_mmddyyyy(d: dt.date) -> str:
    return d.strftime("%m-%d-%Y")


def fetch_puzzle_from_local(source_base_url: str, admin_secret: str, date_iso: dt.date, timeout: float) -> Optional[PuzzleData]:
    """Fetch puzzle by date from local admin endpoint. Returns None on 404."""
    url = f"{source_base_url}/api/admin/puzzles/get_by_date"
    mmddyyyy = ymd_to_mmddyyyy(date_iso)
    try:
        resp = requests.get(
            url,
            params={"date": mmddyyyy},
            headers={"x-admin-secret": admin_secret},
            timeout=timeout,
        )
    except requests.RequestException as exc:
        raise SystemExit(f"Request failed fetching {mmddyyyy} from {url}: {exc}") from exc

    if resp.status_code == 404:
        return None
    if not resp.ok:
        raise SystemExit(f"GET {url} {resp.status_code}: {resp.text}")

    data = resp.json()
    # Expecting keys: date (YYYY-MM-DD), grid, clues
    try:
        puzzle: PuzzleData = {
            "date": data["date"],
            "grid": data["grid"],
            "clues": data.get("clues", []),
        }
        return puzzle
    except Exception as exc:  # noqa: BLE001 (simple validation)
        raise SystemExit(f"Unexpected response shape for date {mmddyyyy}: {data}") from exc


def build_boards_ndjson(puzzles: List[PuzzleData]) -> str:
    lines: List[str] = []
    for p in puzzles:
        record = {"date": p["date"], "board": p["grid"]}
        lines.append(json.dumps(record, separators=(",", ":")))
    return "\n".join(lines) + ("\n" if lines else "")


def build_clues_ndjson(puzzles: List[PuzzleData]) -> str:
    lines: List[str] = []
    for p in puzzles:
        for c in p.get("clues", []):
            record = {
                "date": p["date"],
                "clue": c["clue"],
                "direction": c["direction"],
                "row": c["row"],
                "col": c["col"],
            }
            lines.append(json.dumps(record, separators=(",", ":")))
    return "\n".join(lines) + ("\n" if lines else "")


def post_ndjson(dest_base_url: str, path: str, admin_secret: str, ndjson_text: str, timeout: float) -> requests.Response:
    url = f"{dest_base_url}{path}"
    try:
        resp = requests.post(
            url,
            data=ndjson_text.encode("utf-8"),
            headers={
                "Content-Type": "application/x-ndjson",
                "x-admin-secret": admin_secret,
            },
            timeout=timeout,
        )
        return resp
    except requests.RequestException as exc:
        raise SystemExit(f"POST {url} failed: {exc}") from exc


def main() -> None:
    args = parse_args()

    source_admin_secret, dest_admin_secret = require_admin_secret(
        args.src_admin_secret, args.dest_admin_secret, args.admin_secret, args.tier
    )

    dest_base_url = dest_base_url_for_tier(args.tier).rstrip("/")
    source_base_url = args.src_base_url.rstrip("/")

    start = parse_ymd(args.start_date)
    end = parse_ymd(args.end_date)

    print(f"Promoting puzzles from {source_base_url} -> {dest_base_url}")
    print(f"Date range: {start} to {end} (inclusive)")

    puzzles: List[PuzzleData] = []
    for d in date_range_inclusive(start, end):
        puzzle = fetch_puzzle_from_local(source_base_url, source_admin_secret, d, args.timeout)
        if puzzle is None:
            print(f"- {d}: not found (skipping)")
            continue
        puzzles.append(puzzle)
        print(f"- {d}: fetched")

    if not puzzles:
        print("No puzzles found in the specified range. Nothing to do.")
        return

    boards_ndjson = build_boards_ndjson(puzzles)
    clues_ndjson = build_clues_ndjson(puzzles)

    print(f"Prepared {len(puzzles)} board record(s) and {clues_ndjson.count('\n') or (1 if clues_ndjson else 0)} clue line(s).")

    if args.dry_run:
        print("Dry run: not uploading. Showing first items (truncated):")
        print("Boards NDJSON sample:")
        print("\n".join(boards_ndjson.splitlines()[:2]))
        print("Clues NDJSON sample:")
        print("\n".join(clues_ndjson.splitlines()[:2]))
        return

    # Upload boards first
    boards_resp = post_ndjson(dest_base_url, "/api/admin/boards/bulk_upload", dest_admin_secret, boards_ndjson, args.timeout)
    if not boards_resp.ok:
        raise SystemExit(f"Boards upload failed ({boards_resp.status_code}): {boards_resp.text}")
    try:
        boards_json = boards_resp.json()
    except Exception:
        boards_json = {"raw": boards_resp.text}
    print(f"Boards upload response: {boards_json}")

    # Then upload clues
    if clues_ndjson.strip():
        clues_resp = post_ndjson(dest_base_url, "/api/admin/clues/bulk_upload", dest_admin_secret, clues_ndjson, args.timeout)
        if not clues_resp.ok:
            raise SystemExit(f"Clues upload failed ({clues_resp.status_code}): {clues_resp.text}")
        try:
            clues_json = clues_resp.json()
        except Exception:
            clues_json = {"raw": clues_resp.text}
        print(f"Clues upload response: {clues_json}")
    else:
        print("No clues to upload (all empty)")

    print("Done.")


if __name__ == "__main__":
    main()


