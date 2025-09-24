#!/usr/bin/env python3
"""
Upload previously generated full-board clues from a JSONL file to the API.

This script reads NDJSON records from `full_board_clues.jsonl` (or a provided
path) and uploads them via the admin bulk upload endpoint.

Usage:
  python upload_full_board_clues.py <local|dev|prod> [PATH_TO_JSONL]

Environment variables (per environment):
  - CROSSWORD_ADMIN_URL_LOCAL,  CROSSWORD_ADMIN_KEY_LOCAL
  - CROSSWORD_ADMIN_URL_DEV,    CROSSWORD_ADMIN_KEY_DEV
  - CROSSWORD_ADMIN_URL_PROD,   CROSSWORD_ADMIN_KEY_PROD
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Any, Dict, Tuple

import requests

# Use macOS system trust store so Python requests trusts the same CAs as curl
try:
    import truststore  # type: ignore

    truststore.inject_into_ssl()
except Exception:
    # If truststore is unavailable for any reason, continue; requests will fall back to certifi
    pass

DEFAULT_FILE = os.path.join(os.path.dirname(__file__), "full_board_clues.jsonl")


def get_config(env: str) -> Tuple[str, str]:
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


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Upload full-board clue NDJSON to the database via API")
    parser.add_argument("env", choices=["local", "dev", "prod"], help="Target environment")
    parser.add_argument("path", nargs="?", default=DEFAULT_FILE, help="Path to JSONL file (default: full_board_clues.jsonl)")
    args = parser.parse_args(argv)

    try:
        base_url, admin_key = get_config(args.env)
    except Exception as e:
        print(str(e), file=sys.stderr)
        return 2

    jsonl_path = args.path
    if not os.path.exists(jsonl_path):
        print(f"File not found: {jsonl_path}", file=sys.stderr)
        return 2

    try:
        with open(jsonl_path, "r", encoding="utf-8") as f:
            ndjson_text = f.read()
    except Exception as e:
        print(f"Failed to read file {jsonl_path}: {e}", file=sys.stderr)
        return 2

    if not ndjson_text.strip():
        print("No records found to upload (file is empty).")
        return 0

    print(f"Uploading clues from {jsonl_path} ...")
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


