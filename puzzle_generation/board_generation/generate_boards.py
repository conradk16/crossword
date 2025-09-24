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
from pathlib import Path

import requests

# Use macOS system trust store so Python requests trusts the same CAs as curl
try:
    import truststore  # type: ignore

    truststore.inject_into_ssl()
except Exception:
    # If truststore is unavailable for any reason, continue; requests will fall back to certifi
    pass


OUTPUT_FILE = os.path.join(os.path.dirname(__file__), 'boards.jsonl')


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


# Note: Uploading is now handled by `upload_boards.py`


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
    parser = argparse.ArgumentParser(description='Generate boards from templates and write NDJSON to file (no clues).')
    parser.add_argument('start_date', help='Start date inclusive, in mm-dd-yyyy')
    parser.add_argument('end_date', help='End date inclusive, in mm-dd-yyyy')
    parser.add_argument('tier', choices=['local', 'dev', 'prod'], help='Environment tier')
    args = parser.parse_args()

    try:
        start_dt = datetime.strptime(args.start_date, '%m-%d-%Y').date()
        end_dt = datetime.strptime(args.end_date, '%m-%d-%Y').date()
    except ValueError:
        print('Invalid date format. Use mm-dd-yyyy for start_date and end_date.')
        sys.exit(1)

    if end_dt < start_dt:
        print('end_date must be on or after start_date')
        sys.exit(1)

    try:
        admin_key, base_url = get_config(args.tier)
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

    # Build initial history for the 100 days prior to start date (inclusive of start-100, exclusive of start)
    history_words_by_date: Dict[str, Set[str]] = {}
    previously_used_words: Set[str] = set()

    for i in range(100, 0, -1):
        d = start_dt - timedelta(days=i)
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
        day_words: Set[str] = set()
        for wobj in words_arr:
            if not isinstance(wobj, dict):
                continue
            w = wobj.get('word')
            if isinstance(w, str) and w:
                day_words.add(w.lower())
        if day_words:
            history_words_by_date[iso(d)] = day_words
            previously_used_words.update(day_words)

    # Prepare to generate per-day and stream NDJSON to file
    total_written = 0
    # Ensure directory exists
    Path(os.path.dirname(OUTPUT_FILE)).mkdir(parents=True, exist_ok=True)
    try:
        out_f = open(OUTPUT_FILE, 'w', encoding='utf-8')
    except Exception as e:
        print(f"Failed to open output file {OUTPUT_FILE}: {e}")
        sys.exit(1)

    cur = start_dt
    while cur <= end_dt:
        weekday_name = cur.strftime('%A')
        if weekday_name not in template_by_day:
            print(f"Skipping {iso(cur)} ({weekday_name}) - no template")
            # Roll window: remove words from cur-100 for next day
            drop_day = cur - timedelta(days=100)
            drop_words = history_words_by_date.get(iso(drop_day))
            if drop_words:
                previously_used_words.difference_update(drop_words)
            cur += timedelta(days=1)
            continue

        rows, cols, blacks = template_by_day[weekday_name]

        # Build usable word set for today
        usable_words = base_words.difference(exclusions).difference(previously_used_words)
        if not usable_words:
            print(f"No usable words available for {iso(cur)}; skipping")
            # Roll window for next day
            drop_day = cur - timedelta(days=100)
            drop_words = history_words_by_date.get(iso(drop_day))
            if drop_words:
                previously_used_words.difference_update(drop_words)
            cur += timedelta(days=1)
            continue

        max_len = max(rows, cols)
        trie = build_trie_from_words(usable_words, max_length=max_len, min_length=2)

        grid: List[List[str]] = []
        solved = False
        for attempt in range(20):
            random.seed((hash(iso(cur)) ^ attempt) & 0xFFFFFFFF)
            grid = fill_grid(trie, rows, cols, blacks)
            if grid:
                solved = True
                break
        if not solved:
            print(f"Failed to solve grid for {iso(cur)}; skipping")
            # Roll window for next day
            drop_day = cur - timedelta(days=100)
            drop_words = history_words_by_date.get(iso(drop_day))
            if drop_words:
                previously_used_words.difference_update(drop_words)
            cur += timedelta(days=1)
            continue

        final_grid = build_final_grid(rows, cols, blacks, grid)

        # Compute words used today (lowercase)
        entries = compute_entries(rows, cols, blacks, final_grid)
        today_words: Set[str] = set()
        for e in entries:
            ans = e.get('answer')
            if isinstance(ans, str) and ans:
                today_words.add(ans.lower())

        # Add NDJSON line for later upload
        rec = {
            'date': iso(cur),
            'board': final_grid,
        }
        try:
            out_f.write(json.dumps(rec, ensure_ascii=False) + '\n')
            total_written += 1
            print(f"Generated {iso(cur)}")
        except Exception as e:
            print(f"Failed writing record for {iso(cur)}: {e}")

        # Update history and rolling window for next day
        history_words_by_date[iso(cur)] = today_words
        previously_used_words.update(today_words)
        drop_day = cur - timedelta(days=100)
        drop_words = history_words_by_date.get(iso(drop_day))
        if drop_words:
            previously_used_words.difference_update(drop_words)

        cur += timedelta(days=1)

    try:
        out_f.close()
    except Exception:
        pass

    if total_written == 0:
        print('No boards generated. Nothing written.')
        return

    print(f"Done. Wrote {total_written} board record(s) to {OUTPUT_FILE}")


if __name__ == '__main__':
    main()


