from __future__ import annotations

from typing import Dict, List, Set, Tuple, Optional
from collections import defaultdict
import os
import sys
import re
import json
import random
from datetime import datetime, timedelta, date
import argparse

import requests

# Use macOS system trust store so Python requests trusts the same CAs as curl
try:
    import truststore  # type: ignore

    truststore.inject_into_ssl()
except Exception:
    # If truststore is unavailable for any reason, continue; requests will fall back to certifi
    pass


class TrieNode:
    def __init__(self):
        self.children: Dict[str, TrieNode] = {}
        self.count: int = 0
        self.is_word_end: bool = False


class Trie:
    def __init__(self):
        self.root = TrieNode()

    def add_word(self, word: str) -> None:
        current = self.root
        for c in word:
            if c not in current.children:
                current.children[c] = TrieNode()
            current.count += 1
            current = current.children[c]
        current.count += 1
        current.is_word_end = True

    def remove_word(self, word: str) -> None:
        current = self.root
        for c in word:
            if c not in current.children:
                return
            current.count -= 1
            current = current.children[c]
        current.count -= 1

    def is_valid_prefix(self, prefix: str) -> Set[str]:
        current = self.root
        for c in prefix:
            if c not in current.children:
                return set()
            current = current.children[c]
            if current.count == 0:
                return set()
        return {k for k, v in current.children.items() if v.count > 0}

    def is_word(self, word: str) -> bool:
        current = self.root
        for c in word:
            if c not in current.children:
                return False
            current = current.children[c]
        return current.is_word_end and current.count > 0


def parse_templates(templates_path: str) -> List[Tuple[str, int, int, Set[Tuple[int, int]]]]:
    results: List[Tuple[str, int, int, Set[Tuple[int, int]]]] = []
    with open(templates_path) as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line:
                continue
            m = re.match(r"^([A-Za-z]+)[:|,]\s*(\d+)x(\d+),\s*(\[.*\])$", line)
            if not m:
                parts = re.split(r"[:|,]", line, maxsplit=1)
                if len(parts) < 2:
                    continue
                day = parts[0].strip()
                rest = parts[1].strip()
                m2 = re.match(r"^(\d+)x(\d+),\s*(\[.*\])$", rest)
                if not m2:
                    continue
                rows, cols, blacks_str = int(m2.group(1)), int(m2.group(2)), m2.group(3)
            else:
                day = m.group(1)
                rows, cols = int(m.group(2)), int(m.group(3))
                blacks_str = m.group(4)

            black_squares: Set[Tuple[int, int]] = set()
            if blacks_str and blacks_str != '[]':
                for tup in re.finditer(r"\((\d+)\s*,\s*(\d+)\)", blacks_str):
                    r, c = int(tup.group(1)), int(tup.group(2))
                    black_squares.add((r, c))

            results.append((day, rows, cols, black_squares))
    return results


def build_trie_from_words(all_words: Set[str], max_length: int, min_length: int = 2) -> Trie:
    trie = Trie()
    # Group by length for speed
    words_by_len: Dict[int, List[str]] = defaultdict(list)
    for w in all_words:
        lw = w.lower()
        if not lw.isalpha():
            continue
        if len(lw) < min_length or len(lw) > max_length:
            continue
        words_by_len[len(lw)].append(lw)
    for length, words in words_by_len.items():
        if length < min_length or length > max_length:
            continue
        for word in words:
            trie.add_word(word)
    return trie


def fill_grid(trie: Trie, rows: int, cols: int, black_squares: Set[Tuple[int, int]]) -> List[List[str]]:
    grid: List[List[str]] = [[''] * cols for _ in range(rows)]
    used_words: Set[str] = set()

    fill_positions: List[Tuple[int, int]] = []
    for r in range(rows):
        for c in range(cols):
            if (r, c) not in black_squares:
                fill_positions.append((r, c))

    def is_black(r: int, c: int) -> bool:
        return (r, c) in black_squares

    def get_row_prefix(r: int, c: int) -> str:
        start_c = c
        cc = c - 1
        while cc >= 0 and not is_black(r, cc):
            start_c = cc
            if grid[r][cc] == '':
                break
            cc -= 1
        prefix_chars: List[str] = []
        for x in range(start_c, c):
            if grid[r][x] == '':
                break
            prefix_chars.append(grid[r][x])
        return ''.join(prefix_chars)

    def get_col_prefix(r: int, c: int) -> str:
        start_r = r
        rr = r - 1
        while rr >= 0 and not is_black(rr, c):
            start_r = rr
            if grid[rr][c] == '':
                break
            rr -= 1
        prefix_chars: List[str] = []
        for x in range(start_r, r):
            if grid[x][c] == '':
                break
            prefix_chars.append(grid[x][c])
        return ''.join(prefix_chars)

    def completes_across(r: int, c: int) -> bool:
        return c == cols - 1 or is_black(r, c + 1)

    def completes_down(r: int, c: int) -> bool:
        return r == rows - 1 or is_black(r + 1, c)

    def build_completed_row_word(r: int, c: int, char: str) -> str:
        start_c = c
        cc = c - 1
        while cc >= 0 and not is_black(r, cc) and grid[r][cc] != '':
            start_c = cc
            cc -= 1
        letters: List[str] = []
        for x in range(start_c, c):
            letters.append(grid[r][x])
        letters.append(char)
        return ''.join(letters)

    def build_completed_col_word(r: int, c: int, char: str) -> str:
        start_r = r
        rr = r - 1
        while rr >= 0 and not is_black(rr, c) and grid[rr][c] != '':
            start_r = rr
            rr -= 1
        letters: List[str] = []
        for x in range(start_r, r):
            letters.append(grid[x][c])
        letters.append(char)
        return ''.join(letters)

    def backtrack(pos_index: int) -> bool:
        if pos_index == len(fill_positions):
            return True
        r, c = fill_positions[pos_index]

        row_prefix = get_row_prefix(r, c)
        col_prefix = get_col_prefix(r, c)
        possible_for_row = trie.is_valid_prefix(row_prefix)
        if not possible_for_row:
            return False
        possible_for_col = trie.is_valid_prefix(col_prefix)
        if not possible_for_col:
            return False

        possible = list(possible_for_row.intersection(possible_for_col))
        if not possible:
            return False
        random.shuffle(possible)

        for ch in possible:
            completed_words: List[str] = []
            if completes_across(r, c):
                completed_row_word = build_completed_row_word(r, c, ch)
                if not trie.is_word(completed_row_word):
                    continue
                completed_words.append(completed_row_word)
            if completes_down(r, c):
                completed_col_word = build_completed_col_word(r, c, ch)
                if not trie.is_word(completed_col_word):
                    continue
                completed_words.append(completed_col_word)

            unique_completed = list(dict.fromkeys(completed_words))
            if len(unique_completed) != len(completed_words):
                continue
            if any(w in used_words for w in unique_completed):
                continue

            grid[r][c] = ch
            for w in unique_completed:
                trie.remove_word(w)
                used_words.add(w)

            if backtrack(pos_index + 1):
                return True

            for w in unique_completed:
                trie.add_word(w)
                used_words.remove(w)
            grid[r][c] = ''

        return False

    solved = backtrack(0)
    if not solved:
        return []
    return grid


def compute_entries(rows: int, cols: int, black_squares: Set[Tuple[int, int]], final_grid: List[List[object]]) -> List[Dict[str, object]]:
    entries: List[Dict[str, object]] = []

    def is_black(r: int, c: int) -> bool:
        return (r, c) in black_squares

    # Across
    for r in range(rows):
        c = 0
        while c < cols:
            if not is_black(r, c) and (c == 0 or is_black(r, c - 1)):
                end_c = c
                while end_c < cols and not is_black(r, end_c):
                    end_c += 1
                length = end_c - c
                if length >= 2:
                    letters: List[str] = []
                    for x in range(c, end_c):
                        val = final_grid[r][x]
                        letters.append(val if isinstance(val, str) else '')
                    answer = ''.join(letters)
                    entries.append({
                        'direction': 'across',
                        'row': r,
                        'col': c,
                        'length': length,
                        'answer': answer,
                    })
                c = end_c
            else:
                c += 1

    # Down
    for c in range(cols):
        r = 0
        while r < rows:
            if not is_black(r, c) and (r == 0 or is_black(r - 1, c)):
                end_r = r
                while end_r < rows and not is_black(end_r, c):
                    end_r += 1
                length = end_r - r
                if length >= 2:
                    letters = []
                    for x in range(r, end_r):
                        val = final_grid[x][c]
                        letters.append(val if isinstance(val, str) else '')
                    answer = ''.join(letters)
                    entries.append({
                        'direction': 'down',
                        'row': r,
                        'col': c,
                        'length': length,
                        'answer': answer,
                    })
                r = end_r
            else:
                r += 1

    return entries


def get_config() -> Tuple[str, str]:
    admin_key = os.environ.get('CROSSWORD_ADMIN_KEY_LOCAL')
    base_url = os.environ.get('CROSSWORD_ADMIN_URL_LOCAL')

    if not admin_key:
        raise RuntimeError("Missing CROSSWORD_ADMIN_KEY_LOCAL environment variable")
    if not base_url:
        raise RuntimeError("Missing CROSSWORD_ADMIN_URL_LOCAL environment variable")

    return admin_key, base_url.rstrip('/')


def http_get_word_history(base_url: str, admin_key: str, mm_dd_yyyy: str, timeout: int = 30) -> Optional[Dict[str, object]]:
    url = f"{base_url}/api/admin/boards/get_word_locs_by_date?date={mm_dd_yyyy}"
    headers = {
        'x-admin-secret': admin_key,
    }
    resp = requests.get(url, headers=headers, timeout=timeout)
    if resp.status_code == 404:
        return None
    if resp.status_code >= 400:
        raise RuntimeError(f"History fetch failed for {mm_dd_yyyy}: {resp.status_code} {resp.text}")
    return resp.json()


def http_post_bulk_boards(base_url: str, admin_key: str, ndjson_text: str, timeout: int = 60) -> Dict[str, object]:
    url = f"{base_url}/api/admin/boards/bulk_upload"
    headers = {
        'Content-Type': 'text/plain',
        'x-admin-secret': admin_key,
    }
    resp = requests.post(url, data=ndjson_text.encode('utf-8'), headers=headers, timeout=timeout)
    if resp.status_code >= 400:
        raise RuntimeError(f"Bulk upload failed: {resp.status_code} {resp.text}")
    return resp.json()


def load_base_wordlist(base_dir: str) -> Set[str]:
    path = os.path.join(base_dir, 'filtered_words.txt')
    if not os.path.exists(path):
        raise RuntimeError("Could not find filtered words list. Expected online_lists/filtered_words.txt or filtered_words.txt")

    words: Set[str] = set()
    with open(path) as f:
        for raw_line in f:
            w = raw_line.strip().lower()
            if not w or not w.isalpha():
                continue
            words.add(w)
    return words


def load_exclusions(base_dir: str) -> Set[str]:
    exclusions_path = os.path.join(base_dir, 'conrads_exclusions.txt')
    if not os.path.exists(exclusions_path):
        return set()
    ex: Set[str] = set()
    with open(exclusions_path) as f:
        for raw_line in f:
            w = raw_line.strip().lower()
            if not w or not w.isalpha():
                continue
            ex.add(w)
    return ex


def mmddyyyy(dt: date) -> str:
    return dt.strftime('%m-%d-%Y')


def iso(dt: date) -> str:
    return dt.isoformat()


def build_final_grid(rows: int, cols: int, blacks: Set[Tuple[int, int]], grid: List[List[str]]) -> List[List[object]]:
    final_grid: List[List[object]] = []
    for r in range(rows):
        row_vals: List[object] = []
        for c in range(cols):
            if (r, c) in blacks:
                row_vals.append(None)
            else:
                ch = grid[r][c]
                row_vals.append(ch.upper())
        final_grid.append(row_vals)
    return final_grid


def main():
    parser = argparse.ArgumentParser(description='Generate board for a date and upload to local environment (interactive).')
    parser.add_argument('date', help='Date to generate board for, in mm-dd-yyyy')
    args = parser.parse_args()

    try:
        target_dt = datetime.strptime(args.date, '%m-%d-%Y').date()
    except ValueError:
        print('Invalid date format. Use mm-dd-yyyy for date.')
        sys.exit(1)

    try:
        admin_key, base_url = get_config()
    except Exception as e:
        print(str(e))
        sys.exit(1)

    base_dir = os.path.dirname(__file__)

    # Load templates
    templates_path = os.path.join(base_dir, 'templates.txt')
    parsed_templates = parse_templates(templates_path)
    template_by_day: Dict[str, Tuple[int, int, Set[Tuple[int, int]]]] = {}
    for day, rows, cols, blacks in parsed_templates:
        template_by_day[day] = (rows, cols, blacks)

    # Load word lists
    base_words = load_base_wordlist(base_dir)
    exclusions = load_exclusions(base_dir)

    # Get weekday and check if we have a template
    weekday_name = target_dt.strftime('%A')
    if weekday_name not in template_by_day:
        print(f"No template available for {weekday_name}")
        sys.exit(1)

    rows, cols, blacks = template_by_day[weekday_name]

    # Build history for the 100 days prior to target date (inclusive of target-100, exclusive of target)
    print(f"Loading word history for the 100 days prior to {iso(target_dt)}...")
    previously_used_words: Set[str] = set()

    for i in range(100, 0, -1):
        d = target_dt - timedelta(days=i)
        mmdd = mmddyyyy(d)
        try:
            payload = http_get_word_history(base_url, admin_key, mmdd)
        except Exception as e:
            print(f"Failed to fetch history for {mmdd}: {e}")
            payload = None
        if not payload:
            continue
        words_arr = payload.get('words') if isinstance(payload, dict) else None
        if not isinstance(words_arr, list):
            continue
        for wobj in words_arr:
            if not isinstance(wobj, dict):
                continue
            w = wobj.get('word')
            if isinstance(w, str) and w:
                previously_used_words.add(w.lower())

    # Build usable word set
    usable_words = base_words.difference(exclusions).difference(previously_used_words)
    if not usable_words:
        print(f"No usable words available for {iso(target_dt)}")
        sys.exit(1)

    max_len = max(rows, cols)
    print(f"Building word trie for {rows}x{cols} grid...")
    trie = build_trie_from_words(usable_words, max_length=max_len, min_length=2)

    # Interactive generation loop
    attempt_num = 0
    while True:
        print(f"\n{'='*60}")
        print(f"Generating board for {iso(target_dt)} ({weekday_name}) - Attempt {attempt_num + 1}")
        print(f"{'='*60}")

        grid: List[List[str]] = []
        solved = False
        for inner_attempt in range(20):
            random.seed((hash(iso(target_dt)) ^ attempt_num ^ inner_attempt) & 0xFFFFFFFF)
            grid = fill_grid(trie, rows, cols, blacks)
            if grid:
                solved = True
                break

        if not solved:
            print(f"Failed to solve grid after 20 attempts")
            attempt_num += 1
            continue

        final_grid = build_final_grid(rows, cols, blacks, grid)

        # Compute and display words used
        entries = compute_entries(rows, cols, blacks, final_grid)
        print(f"\nGenerated board with {len(entries)} entries:")
        for e in entries:
            print(f"  {e['direction']:>6} ({e['row']},{e['col']}): {e['answer']}")

        # Upload the board
        rec = {
            'date': iso(target_dt),
            'board': final_grid,
        }
        ndjson_text = json.dumps(rec, ensure_ascii=False) + '\n'

        print(f"\nUploading board to local environment...")
        try:
            result = http_post_bulk_boards(base_url, admin_key, ndjson_text)
            print(f"Upload successful: {result}")
        except Exception as e:
            print(f"Upload failed: {e}")
            sys.exit(1)

        # Ask user if satisfied
        while True:
            response = input("\nAre you satisfied with this board? (y/n): ").strip().lower()
            if response in ['y', 'yes']:
                print("\nDone! Board accepted.")
                return
            elif response in ['n', 'no']:
                print("\nRegenerating...")
                attempt_num += 1
                break
            else:
                print("Please enter 'y' or 'n'")


if __name__ == '__main__':
    main()


