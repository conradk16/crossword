import os
import sys
import requests

# Use macOS system trust store so Python requests trusts the same CAs as curl
try:
    import truststore  # type: ignore

    truststore.inject_into_ssl()
except Exception:
    # If truststore is unavailable for any reason, continue; requests will fall back to certifi
    pass


def get_args():
    if len(sys.argv) != 3 or sys.argv[1] not in ("dev", "prod", "local"):
        print("usage: python3 upload_puzzles.py <dev|prod|local> <path_to_jsonl>")
        sys.exit(1)
    return sys.argv[1], sys.argv[2]


def get_config(tier: str):
    if tier == "prod":
        admin_key = os.environ.get("CROSSWORD_ADMIN_KEY_PROD")
        api_url = os.environ.get("CROSSWORD_ADMIN_URL_PROD")
    elif tier == "dev":
        admin_key = os.environ.get("CROSSWORD_ADMIN_KEY_DEV")
        api_url = os.environ.get("CROSSWORD_ADMIN_URL_DEV")
    elif tier == "local":
        admin_key = os.environ.get("CROSSWORD_ADMIN_KEY_LOCAL")
        api_url = os.environ.get("CROSSWORD_ADMIN_URL_LOCAL")

    if not admin_key:
        print("Missing admin key environment variable for tier", tier)
        sys.exit(1)

    if not api_url:
        print("Missing crossword admin url variable for tier", tier)

    return admin_key, api_url


def upload_file(tier: str, path: str):
    if not os.path.isfile(path):
        print("File not found:", path)
        sys.exit(1)

    admin_key, api_url = get_config(tier)

    with open(path, "rb") as f:
        data = f.read()

    headers = {
        "Content-Type": "text/plain",
        "x-admin-secret": admin_key,
    }
    resp = requests.post(api_url, data=data, headers=headers, timeout=60)
    if resp.status_code >= 400:
        print("Upload failed", resp.status_code, resp.text)
        sys.exit(1)
    print(resp.json())


if __name__ == "__main__":
    tier, jsonl_path = get_args()
    upload_file(tier, jsonl_path)


