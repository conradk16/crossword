#!/usr/bin/env python3
"""
Upload previously generated boards from a JSONL file to the API.

This script reads NDJSON records from `boards.jsonl` (or a provided path)
and uploads them via the admin bulk upload endpoint.

Usage:
  python upload_boards.py <local|dev|prod> [PATH_TO_JSONL]

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

DEFAULT_FILE = os.path.join(os.path.dirname(__file__), 'boards.jsonl')


def get_config(tier: str) -> Tuple[str, str]:
    if tier == 'prod':
        admin_key = os.environ.get('CROSSWORD_ADMIN_KEY_PROD')
        base_url = os.environ.get('CROSSWORD_ADMIN_URL_PROD')
    elif tier == 'dev':
        admin_key = os.environ.get('CROSSWORD_ADMIN_KEY_DEV')
        base_url = os.environ.get('CROSSWORD_ADMIN_URL_DEV')
    elif tier == 'local':
        admin_key = os.environ.get('CROSSWORD_ADMIN_KEY_LOCAL')
        base_url = os.environ.get('CROSSWORD_ADMIN_URL_LOCAL')
    else:
        raise RuntimeError("Invalid tier; expected one of: local, dev, prod")

    if not admin_key:
        raise RuntimeError(f"Missing admin key environment variable for tier {tier}")
    if not base_url:
        raise RuntimeError(f"Missing crossword admin url variable for tier {tier}")

    return admin_key, base_url.rstrip('/')


def http_post_bulk_boards(base_url: str, admin_key: str, ndjson_text: str, timeout: int = 60) -> Dict[str, Any]:
    url = f"{base_url}/api/admin/boards/bulk_upload"
    headers = {
        'Content-Type': 'text/plain',
        'x-admin-secret': admin_key,
    }
    resp = requests.post(url, data=ndjson_text.encode('utf-8'), headers=headers, timeout=timeout)
    if resp.status_code >= 400:
        raise RuntimeError(f"Bulk upload failed: {resp.status_code} {resp.text}")
    return resp.json()


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description='Upload board NDJSON to the database via API')
    parser.add_argument('tier', choices=['local', 'dev', 'prod'], help='Environment tier')
    parser.add_argument('path', nargs='?', default=DEFAULT_FILE, help='Path to JSONL file (default: boards.jsonl)')
    args = parser.parse_args(argv)

    try:
        admin_key, base_url = get_config(args.tier)
    except Exception as e:
        print(str(e))
        return 2

    jsonl_path = args.path
    if not os.path.exists(jsonl_path):
        print(f"File not found: {jsonl_path}", file=sys.stderr)
        return 2

    try:
        with open(jsonl_path, 'r', encoding='utf-8') as f:
            ndjson_text = f.read()
    except Exception as e:
        print(f"Failed to read file {jsonl_path}: {e}", file=sys.stderr)
        return 2

    if not ndjson_text.strip():
        print('No records found to upload (file is empty).')
        return 0

    print(f"Uploading boards from {jsonl_path} ...")
    try:
        result = http_post_bulk_boards(base_url, admin_key, ndjson_text)
    except Exception as e:
        print(f"Bulk upload failed: {e}", file=sys.stderr)
        return 1

    print(result)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))


