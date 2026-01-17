#!/usr/bin/env python3
"""
Copy the last 100 days of boards from production to local database.

For each date in the last 100 days (inclusive):
  1) Fetch the puzzle from production's admin endpoint:
       GET /api/admin/puzzles/get_by_date?date=MM-DD-YYYY
     with header: x-admin-secret: <PROD_ADMIN_SECRET>

  2) Upload the board to local via NDJSON:
       POST /api/admin/boards/bulk_upload
       body per line: {"date":"YYYY-MM-DD","board":(string|null)[][]}

  3) Upload the clues to local via NDJSON:
       POST /api/admin/clues/bulk_upload
       body per line: {"date":"YYYY-MM-DD","clue":string,"direction":"across"|"down","row":number,"col":number}

Authentication
  - Uses header x-admin-secret on all admin endpoints.
  - Admin URLs and secrets can be provided via env:
      CROSSWORD_ADMIN_URL_LOCAL, CROSSWORD_ADMIN_URL_PROD
      CROSSWORD_ADMIN_KEY_LOCAL, CROSSWORD_ADMIN_KEY_PROD
    Or via flags: --prod-admin-secret, --local-admin-secret
    Fallback for secrets: CROSSWORD_ADMIN_KEY

Usage
  python copy_prod_boards_to_local.py [--days N] [--local-base-url URL] [--dry-run]

Examples
  python copy_prod_boards_to_local.py
  python copy_prod_boards_to_local.py --days 50 --dry-run
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from typing import Iterable, List, Optional, Tuple, TypedDict

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


DEFAULT_LOCAL_BASE_URL = env_admin_url("CROSSWORD_ADMIN_URL_LOCAL", "http://localhost:3000") or "http://localhost:3000"
DEFAULT_PROD_BASE_URL = env_admin_url("CROSSWORD_ADMIN_URL_PROD", "https://conradscrossword.com") or "https://conradscrossword.com"


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
    parser = argparse.ArgumentParser(description="Copy the last N days of boards from production to local.")
    parser.add_argument("--days", type=int, default=100, help="Number of days to copy (default: %(default)s)")
    parser.add_argument("--local-base-url", default=DEFAULT_LOCAL_BASE_URL, help="Local base URL (default: %(default)s)")
    parser.add_argument("--prod-admin-secret", default=None, help="Admin secret for production (env CROSSWORD_ADMIN_KEY_PROD or CROSSWORD_ADMIN_KEY)")
    parser.add_argument("--local-admin-secret", default=(env_admin_key("CROSSWORD_ADMIN_KEY_LOCAL") or os.environ.get("CROSSWORD_ADMIN_KEY")), help="Admin secret for local (env CROSSWORD_ADMIN_KEY_LOCAL or CROSSWORD_ADMIN_KEY)")
    parser.add_argument("--admin-secret", default=os.environ.get("CROSSWORD_ADMIN_KEY"), help="Fallback admin secret for both if specific ones are not set (env CROSSWORD_ADMIN_KEY)")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be uploaded without making requests")
    parser.add_argument("--timeout", type=float, default=30.0, help="HTTP timeout seconds (default: %(default)s)")
    return parser.parse_args()


def require_admin_secrets(prod_secret: Optional[str], local_secret: Optional[str], fallback: Optional[str]) -> Tuple[str, str]:
    prod_secret = prod_secret or env_admin_key("CROSSWORD_ADMIN_KEY_PROD") or fallback
    local_secret = local_secret or env_admin_key("CROSSWORD_ADMIN_KEY_LOCAL") or fallback
    if not prod_secret:
        raise SystemExit("Missing production admin secret. Provide --prod-admin-secret or set CROSSWORD_ADMIN_KEY_PROD or CROSSWORD_ADMIN_KEY")
    if not local_secret:
        raise SystemExit("Missing local admin secret. Provide --local-admin-secret or set CROSSWORD_ADMIN_KEY_LOCAL or CROSSWORD_ADMIN_KEY")
    return prod_secret, local_secret


def ymd_to_mmddyyyy(d: dt.date) -> str:
    return d.strftime("%m-%d-%Y")


def get_pacific_today(prod_base_url: str, prod_admin_secret: str) -> dt.date:
    """Get today's date in Pacific timezone by querying production API."""
    # Try to fetch today's puzzle from prod to determine the current Pacific date
    # We'll try a few recent dates to find today
    today_local = dt.date.today()
    for offset in range(3):  # Try today and up to 2 days in the past
        test_date = today_local - dt.timedelta(days=offset)
        try:
            puzzle = fetch_puzzle_from_prod(prod_base_url, prod_admin_secret, test_date, 5.0)
            if puzzle:
                # Found a puzzle, this is likely today or very recent
                return test_date
        except Exception:
            # If fetch fails, continue trying
            continue
    
    # Fallback: Use a simple approximation
    # Get current UTC time and convert to Pacific (UTC-8 for PST, UTC-7 for PDT)
    # We'll use UTC-8 as a conservative estimate (PST)
    # Note: This doesn't account for DST, but should be close enough for the purpose
    utc_now = dt.datetime.now(dt.timezone.utc)
    pacific_offset = dt.timedelta(hours=8)
    pacific_now = utc_now - pacific_offset
    return pacific_now.date()


def date_range_last_n_days(n: int, today: dt.date) -> Iterable[dt.date]:
    """Generate dates for the last N days (inclusive), starting from today."""
    for i in range(n):
        yield today - dt.timedelta(days=i)


def fetch_puzzle_from_prod(prod_base_url: str, admin_secret: str, date_iso: dt.date, timeout: float) -> Optional[PuzzleData]:
    """Fetch puzzle by date from production admin endpoint. Returns None on 404."""
    url = f"{prod_base_url}/api/admin/puzzles/get_by_date"
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


def build_clues_ndjson(puzzles: List[PuzzleData]) -> Tuple[str, int, List[str]]:
    """Build clues NDJSON, filtering out invalid clues. Returns (ndjson, filtered_count, dates_with_invalid_clues)."""
    lines: List[str] = []
    filtered_count = 0
    dates_with_invalid_clues: List[str] = []
    for p in puzzles:
        puzzle_has_invalid = False
        for c in p.get("clues", []):
            # Filter out clues with missing, empty, or non-string clue values
            clue_value = c.get("clue")
            if not clue_value or not isinstance(clue_value, str) or not clue_value.strip():
                filtered_count += 1
                if not puzzle_has_invalid:
                    dates_with_invalid_clues.append(p["date"])
                    puzzle_has_invalid = True
                continue
            record = {
                "date": p["date"],
                "clue": clue_value,
                "direction": c["direction"],
                "row": c["row"],
                "col": c["col"],
            }
            lines.append(json.dumps(record, separators=(",", ":")))
    return "\n".join(lines) + ("\n" if lines else ""), filtered_count, dates_with_invalid_clues


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

    prod_admin_secret, local_admin_secret = require_admin_secrets(
        args.prod_admin_secret, args.local_admin_secret, args.admin_secret
    )

    prod_base_url = DEFAULT_PROD_BASE_URL.rstrip("/")
    local_base_url = args.local_base_url.rstrip("/")

    # Get today's date in Pacific timezone by querying prod
    print("Determining today's date in Pacific timezone...")
    today = get_pacific_today(prod_base_url, prod_admin_secret)
    start_date = today - dt.timedelta(days=args.days - 1)
    end_date = today

    print(f"Copying puzzles from {prod_base_url} -> {local_base_url}")
    print(f"Date range: last {args.days} days ({start_date} to {end_date}, inclusive)")

    puzzles: List[PuzzleData] = []
    for d in date_range_last_n_days(args.days, today):
        puzzle = fetch_puzzle_from_prod(prod_base_url, prod_admin_secret, d, args.timeout)
        if puzzle is None:
            print(f"- {d}: not found (skipping)")
            continue
        puzzles.append(puzzle)
        print(f"- {d}: fetched")

    if not puzzles:
        print("No puzzles found in the specified range. Nothing to do.")
        return

    boards_ndjson = build_boards_ndjson(puzzles)
    clues_ndjson, filtered_clues_count, dates_with_invalid_clues = build_clues_ndjson(puzzles)

    clue_line_count = clues_ndjson.count('\n') or (1 if clues_ndjson else 0)
    print(f"Prepared {len(puzzles)} board record(s) and {clue_line_count} clue line(s).")
    if filtered_clues_count > 0:
        print(f"Filtered out {filtered_clues_count} invalid clue(s) (empty or missing clue text).")
        print(f"Dates with invalid clues: {', '.join(sorted(dates_with_invalid_clues))}")

    if args.dry_run:
        print("Dry run: not uploading. Showing first items (truncated):")
        print("Boards NDJSON sample:")
        print("\n".join(boards_ndjson.splitlines()[:2]))
        print("Clues NDJSON sample:")
        print("\n".join(clues_ndjson.splitlines()[:2]))
        return

    # Upload boards first
    boards_resp = post_ndjson(local_base_url, "/api/admin/boards/bulk_upload", local_admin_secret, boards_ndjson, args.timeout)
    if not boards_resp.ok:
        raise SystemExit(f"Boards upload failed ({boards_resp.status_code}): {boards_resp.text}")
    try:
        boards_json = boards_resp.json()
    except Exception:
        boards_json = {"raw": boards_resp.text}
    print(f"Boards upload response: {boards_json}")

    # Then upload clues
    if clues_ndjson.strip():
        clues_resp = post_ndjson(local_base_url, "/api/admin/clues/bulk_upload", local_admin_secret, clues_ndjson, args.timeout)
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

