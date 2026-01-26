#!/usr/bin/env python3
"""
Fetch and print a crossword puzzle by date from the admin API.

Usage:
  python print_puzzle.py <local|dev|prod> MM-DD-YYYY

Environment variables (per environment):
  - CROSSWORD_ADMIN_URL_LOCAL,  CROSSWORD_ADMIN_KEY_LOCAL
  - CROSSWORD_ADMIN_URL_DEV,    CROSSWORD_ADMIN_KEY_DEV
  - CROSSWORD_ADMIN_URL_PROD,   CROSSWORD_ADMIN_KEY_PROD

The URL variables should be base URLs, e.g. https://example.com
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

# Use macOS system trust store so Python requests trusts the same CAs as curl
try:
    import truststore  # type: ignore
    truststore.inject_into_ssl()
except Exception:
    pass

DATE_REGEX = re.compile(r"^\d{2}-\d{2}-\d{4}$")


def validate_date_or_exit(date_str: str) -> None:
    if not DATE_REGEX.match(date_str):
        print("Error: date must be in MM-DD-YYYY format", file=sys.stderr)
        sys.exit(2)


def build_url(base_url: str, date_str: str) -> str:
    base = base_url.rstrip("/")
    query = urllib.parse.urlencode({"date": date_str})
    return f"{base}/api/admin/puzzles/get_by_date?{query}"


def fetch_puzzle(date_str: str, base_url: str, admin_key: str, timeout_seconds: int = 20) -> Dict[str, Any]:
    url = build_url(base_url, date_str)
    req = urllib.request.Request(url)
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
    req.add_header("x-admin-secret", admin_key)

    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
            content_type = resp.headers.get("Content-Type", "")
            body = resp.read().decode("utf-8", errors="replace")
            if "application/json" not in content_type:
                raise ValueError(f"Unexpected content type: {content_type}")
            data = json.loads(body)
            return data
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8", errors="replace")
            detail = json.loads(body)
        except Exception:
            detail = {"error": body if 'body' in locals() else str(e)}
        msg = detail.get("error") if isinstance(detail, dict) else str(detail)
        print(f"HTTP {e.code}: {msg}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Request error: {e}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError:
        print("Failed to parse JSON response", file=sys.stderr)
        sys.exit(1)


def format_grid(grid: List[List[Optional[str]]]) -> str:
    lines: List[str] = []
    for row in grid:
        display_cells: List[str] = []
        for cell in row:
            if cell is None:
                display_cells.append("■")
            else:
                display_cells.append(str(cell).upper())
        lines.append(" ".join(display_cells))
    return "\n".join(lines)


def print_clues(clues: List[Dict[str, Any]]) -> None:
    # Sort across clues by row, then col
    across = sorted(
        [c for c in clues if c.get("direction") == "across"],
        key=lambda c: (c.get("row", 0), c.get("col", 0)),
    )
    # Sort down clues by col, then row
    down = sorted(
        [c for c in clues if c.get("direction") == "down"],
        key=lambda c: (c.get("col", 0), c.get("row", 0)),
    )
    
    # Print all clues without section headers
    for c in across + down:
        row = int(c.get("row", 0))
        col = int(c.get("col", 0))
        direction = c.get("direction", "")
        clue_text = c.get("clue", "")
        print(f" {row}, {col}, {direction}, {clue_text}")


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(description="Fetch and print a crossword puzzle by date")
    parser.add_argument("env", choices=["local", "dev", "prod"], help="Target environment")
    parser.add_argument("date", help="Date in MM-DD-YYYY format")
    args = parser.parse_args(argv)

    validate_date_or_exit(args.date)

    env_upper = {"local": "LOCAL", "dev": "DEV", "prod": "PROD"}[args.env]
    url_var = f"CROSSWORD_ADMIN_URL_{env_upper}"
    key_var = f"CROSSWORD_ADMIN_KEY_{env_upper}"

    base_url = os.environ.get(url_var)
    admin_key = os.environ.get(key_var)

    if not base_url:
        print(f"Error: environment variable {url_var} is required", file=sys.stderr)
        return 2
    if not admin_key:
        print(f"Error: environment variable {key_var} is required", file=sys.stderr)
        return 2

    data = fetch_puzzle(args.date, base_url=base_url, admin_key=admin_key)

    date_str = data.get("date", args.date)
    grid = data.get("grid")
    clues = data.get("clues", [])

    if not isinstance(grid, list) or not grid:
        print("No grid returned", file=sys.stderr)
        return 1

    print(f"Date: {date_str}")
    print("\nGrid:")
    print(format_grid(grid))
    print("\nClues:")
    print_clues(clues)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))


