from __future__ import annotations

from typing import Dict, List, Set, Tuple, Optional
import os
import sys
import re
import json
import random
import time
import zlib
import multiprocessing
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


def compute_slot_map(
    rows: int, cols: int, black_squares: Set[Tuple[int, int]]
) -> Tuple[Dict[Tuple[int, int], Tuple[int, int]], Dict[Tuple[int, int], Tuple[int, int]]]:
    """For every open cell, the (start, length) of the across and down run it belongs to."""
    row_slot: Dict[Tuple[int, int], Tuple[int, int]] = {}
    col_slot: Dict[Tuple[int, int], Tuple[int, int]] = {}

    for r in range(rows):
        c = 0
        while c < cols:
            if (r, c) in black_squares:
                c += 1
                continue
            end = c
            while end < cols and (r, end) not in black_squares:
                end += 1
            for x in range(c, end):
                row_slot[(r, x)] = (c, end - c)
            c = end

    for c in range(cols):
        r = 0
        while r < rows:
            if (r, c) in black_squares:
                r += 1
                continue
            end = r
            while end < rows and (end, c) not in black_squares:
                end += 1
            for x in range(r, end):
                col_slot[(x, c)] = (r, end - r)
            r = end

    return row_slot, col_slot


def required_slot_lengths(
    row_slot: Dict[Tuple[int, int], Tuple[int, int]],
    col_slot: Dict[Tuple[int, int], Tuple[int, int]],
) -> Set[int]:
    """The distinct answer lengths a template actually needs (runs of 1 are not entries)."""
    lengths: Set[int] = set()
    for _, length in row_slot.values():
        if length >= 2:
            lengths.add(length)
    for _, length in col_slot.values():
        if length >= 2:
            lengths.add(length)
    return lengths


def build_tries_by_length(all_words: Set[str], lengths: Set[int]) -> Dict[int, Trie]:
    """One trie per answer length.

    A single shared trie cannot tell "some word continues this prefix" from "a word of
    the length this slot needs continues this prefix", so the search spends a large part
    of its time descending prefixes that can only finish at the wrong length.
    """
    tries: Dict[int, Trie] = {length: Trie() for length in lengths}
    for w in all_words:
        lw = w.lower()
        if not lw.isalpha():
            continue
        trie = tries.get(len(lw))
        if trie is not None:
            trie.add_word(lw)
    return tries


# backtrack() outcomes: solved, fully explored with no solution, or cut off by the budget.
_SOLVED = 1
_FAILED = 0
_ABORTED = -1


def fill_grid(
    tries: Dict[int, Trie],
    rows: int,
    cols: int,
    black_squares: Set[Tuple[int, int]],
    row_slot: Dict[Tuple[int, int], Tuple[int, int]],
    col_slot: Dict[Tuple[int, int], Tuple[int, int]],
    node_budget: Optional[int] = None,
) -> Tuple[List[List[str]], bool]:
    """Fill the grid one letter at a time.

    Returns (grid, exhausted). grid is [] when nothing was found; exhausted is True only
    when the whole search space was explored, meaning the template is unfillable with the
    current word list and retrying under a different seed cannot help.
    """
    grid: List[List[str]] = [[''] * cols for _ in range(rows)]
    used_words: Set[str] = set()
    nodes = 0

    fill_positions: List[Tuple[int, int]] = []
    for r in range(rows):
        for c in range(cols):
            if (r, c) not in black_squares:
                fill_positions.append((r, c))

    def backtrack(pos_index: int) -> int:
        nonlocal nodes
        if pos_index == len(fill_positions):
            return _SOLVED
        nodes += 1
        if node_budget is not None and nodes > node_budget:
            return _ABORTED

        r, c = fill_positions[pos_index]
        row_start, row_len = row_slot[(r, c)]
        col_start, col_len = col_slot[(r, c)]
        # A run of length 1 is not an entry, so it constrains nothing.
        row_trie = tries.get(row_len)
        col_trie = tries.get(col_len)

        row_prefix = ''
        col_prefix = ''
        possible: Optional[Set[str]] = None

        if row_trie is not None:
            row_prefix = ''.join(grid[r][x] for x in range(row_start, c))
            possible = row_trie.is_valid_prefix(row_prefix)
            if not possible:
                return _FAILED
        if col_trie is not None:
            col_prefix = ''.join(grid[x][c] for x in range(col_start, r))
            possible_col = col_trie.is_valid_prefix(col_prefix)
            if not possible_col:
                return _FAILED
            possible = possible_col if possible is None else possible.intersection(possible_col)

        if possible is None:
            possible = set('abcdefghijklmnopqrstuvwxyz')
        if not possible:
            return _FAILED

        candidates = list(possible)
        random.shuffle(candidates)

        for ch in candidates:
            completed: List[Tuple[int, str]] = []
            if row_trie is not None and c == row_start + row_len - 1:
                word = row_prefix + ch
                if not row_trie.is_word(word):
                    continue
                completed.append((row_len, word))
            if col_trie is not None and r == col_start + col_len - 1:
                word = col_prefix + ch
                if not col_trie.is_word(word):
                    continue
                completed.append((col_len, word))

            words = [w for _, w in completed]
            if len(set(words)) != len(words):
                continue
            if any(w in used_words for w in words):
                continue

            grid[r][c] = ch
            for length, word in completed:
                tries[length].remove_word(word)
                used_words.add(word)

            result = backtrack(pos_index + 1)
            if result == _SOLVED:
                return _SOLVED

            for length, word in completed:
                tries[length].add_word(word)
                used_words.discard(word)
            grid[r][c] = ''

            if result == _ABORTED:
                return _ABORTED

        return _FAILED

    result = backtrack(0)
    # The solved path returns without unwinding, so put the placed words back either way;
    # the caller reuses these tries for every later attempt.
    for word in used_words:
        tries[len(word)].add_word(word)

    if result == _SOLVED:
        return grid, False
    return [], result == _FAILED


# Randomised backtracking on these templates is heavy tailed: most seeds finish quickly
# and a minority run essentially forever. Capping the search and restarting under a new
# seed converts that tail into a bounded, parallelisable cost.
INITIAL_NODE_BUDGET = 200_000
MAX_NODE_BUDGET = 25_600_000

# Per-process state for pool workers, populated by _worker_init.
_WORKER_STATE: Dict[str, object] = {}


def _worker_init(
    words: Set[str], rows: int, cols: int, black_squares: Set[Tuple[int, int]]
) -> None:
    row_slot, col_slot = compute_slot_map(rows, cols, black_squares)
    tries = build_tries_by_length(words, required_slot_lengths(row_slot, col_slot))
    _WORKER_STATE['tries'] = tries
    _WORKER_STATE['geometry'] = (rows, cols, black_squares, row_slot, col_slot)


def _worker_attempt(task: Tuple[int, int]) -> Tuple[int, List[List[str]], bool]:
    seed, budget = task
    rows, cols, black_squares, row_slot, col_slot = _WORKER_STATE['geometry']  # type: ignore[misc]
    random.seed(seed)
    grid, exhausted = fill_grid(
        _WORKER_STATE['tries'],  # type: ignore[arg-type]
        rows, cols, black_squares, row_slot, col_slot,
        node_budget=budget,
    )
    return seed, grid, exhausted


def solve_board(
    tries: Optional[Dict[int, Trie]],
    rows: int,
    cols: int,
    black_squares: Set[Tuple[int, int]],
    row_slot: Dict[Tuple[int, int], Tuple[int, int]],
    col_slot: Dict[Tuple[int, int], Tuple[int, int]],
    seed_base: int,
    pool: Optional[object] = None,
    workers: int = 1,
) -> Tuple[List[List[str]], Optional[int], str]:
    """Race several budgeted, randomly seeded searches; double the budget each round.

    Returns (grid, winning_seed, status) where status is 'solved', 'infeasible' (the
    template cannot be filled from this word list) or 'budget' (gave up).
    """
    budget = INITIAL_NODE_BUDGET
    seed = seed_base

    while budget <= MAX_NODE_BUDGET:
        tasks = [(seed + i, budget) for i in range(max(1, workers))]
        seed += len(tasks)

        if pool is not None:
            results = pool.imap_unordered(_worker_attempt, tasks)
        else:
            results = (
                (
                    t[0],
                    *_run_attempt_locally(tries, rows, cols, black_squares, row_slot, col_slot, t),
                )
                for t in tasks
            )

        for won_seed, grid, exhausted in results:
            if grid:
                return grid, won_seed, 'solved'
            if exhausted:
                # Fully explored: a different seed walks the same tree in a different
                # order, so there is nothing to gain from retrying.
                return [], None, 'infeasible'

        budget *= 2

    return [], None, 'budget'


def _run_attempt_locally(
    tries: Optional[Dict[int, Trie]],
    rows: int,
    cols: int,
    black_squares: Set[Tuple[int, int]],
    row_slot: Dict[Tuple[int, int], Tuple[int, int]],
    col_slot: Dict[Tuple[int, int], Tuple[int, int]],
    task: Tuple[int, int],
) -> Tuple[List[List[str]], bool]:
    assert tries is not None
    seed, budget = task
    random.seed(seed)
    return fill_grid(tries, rows, cols, black_squares, row_slot, col_slot, node_budget=budget)


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


def fetch_word_history(base_url: str, admin_key: str, target_dt: date) -> Set[str]:
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

    return previously_used_words


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
    # Each line is "word" or "word,reason" (reason is optional and ignored here).
    ex: Set[str] = set()
    for filename in ('conrads_exclusions.txt', 'bots_exclusions.txt'):
        exclusions_path = os.path.join(base_dir, filename)
        if not os.path.exists(exclusions_path):
            continue
        with open(exclusions_path) as f:
            for raw_line in f:
                w = raw_line.split(',', 1)[0].strip().lower()
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
    parser.add_argument(
        '--workers',
        type=int,
        default=min(8, os.cpu_count() or 1),
        help='Parallel search processes to race against each other (1 disables multiprocessing)',
    )
    args = parser.parse_args()

    workers = max(1, args.workers)

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

    # Fetch 100 days of history (only done once at startup)
    previously_used_words = fetch_word_history(base_url, admin_key, target_dt)

    # Outer loop over dates (re-entered when user chooses "next day")
    while True:
        weekday_name = target_dt.strftime('%A')
        if weekday_name not in template_by_day:
            print(f"No template available for {weekday_name}")
            sys.exit(1)

        rows, cols, blacks = template_by_day[weekday_name]

        # Add singular/plural variants to previously used words
        expanded_exclusions: Set[str] = set(previously_used_words)
        for word in previously_used_words:
            if word.endswith('s'):
                expanded_exclusions.add(word[:-1])
            else:
                expanded_exclusions.add(word + 's')

        # Build usable word set
        usable_words = base_words.difference(exclusions).difference(expanded_exclusions)
        if not usable_words:
            print(f"No usable words available for {iso(target_dt)}")
            sys.exit(1)

        row_slot, col_slot = compute_slot_map(rows, cols, blacks)
        slot_lengths = required_slot_lengths(row_slot, col_slot)

        counts: Dict[int, int] = {length: 0 for length in slot_lengths}
        for w in usable_words:
            if len(w) in counts:
                counts[len(w)] += 1
        empty = sorted(length for length, n in counts.items() if n == 0)
        if empty:
            print(
                f"No usable {'/'.join(str(x) for x in empty)}-letter words remain, so the "
                f"{weekday_name} template cannot be filled."
            )
            sys.exit(1)

        print(f"Building word tries for {rows}x{cols} grid...")
        # With a pool each worker builds its own tries in _worker_init.
        tries: Optional[Dict[int, Trie]] = (
            build_tries_by_length(usable_words, slot_lengths) if workers == 1 else None
        )

        pool = None
        if workers > 1:
            pool = multiprocessing.Pool(
                processes=workers,
                initializer=_worker_init,
                initargs=(usable_words, rows, cols, blacks),
            )
            print(f"Racing {workers} search processes.")

        # Interactive generation loop
        attempt_num = 0
        advance_to_next_day = False
        while True:
            print(f"\n{'='*60}")
            print(f"Generating board for {iso(target_dt)} ({weekday_name}) - Attempt {attempt_num + 1}")
            print(f"{'='*60}")

            # zlib.crc32 rather than hash(): str hashing is salted per process, so seeds
            # built from it are not reproducible across runs.
            seed_base = (zlib.crc32(iso(target_dt).encode()) + attempt_num * 1_000_003) & 0xFFFFFFFF

            started = time.monotonic()
            grid, won_seed, status = solve_board(
                tries, rows, cols, blacks, row_slot, col_slot,
                seed_base, pool=pool, workers=workers,
            )
            elapsed = time.monotonic() - started

            if status == 'infeasible':
                print(
                    "This template cannot be filled from the remaining word list "
                    "(the search space was explored exhaustively). Try relaxing exclusions."
                )
                if pool is not None:
                    pool.terminate()
                sys.exit(1)
            if status != 'solved':
                print(f"Gave up after {elapsed:.1f}s without finding a fill; retrying.")
                attempt_num += 1
                continue

            print(f"Solved in {elapsed:.1f}s (seed {won_seed}).")

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
                if pool is not None:
                    pool.terminate()
                sys.exit(1)

            # Ask user if satisfied
            while True:
                response = input("\nAre you satisfied with this board? (y/n): ").strip().lower()
                if response in ['y', 'yes']:
                    print("\nBoard accepted.")
                    # Add this board's words to history for next day
                    for e in entries:
                        previously_used_words.add(e['answer'].lower())
                    # Ask about next day
                    while True:
                        nd = input("Next day? (y/n): ").strip().lower()
                        if nd in ['y', 'yes']:
                            target_dt += timedelta(days=1)
                            advance_to_next_day = True
                            break
                        elif nd in ['n', 'no']:
                            print("\nDone!")
                            if pool is not None:
                                pool.terminate()
                            return
                        else:
                            print("Please enter 'y' or 'n'")
                    break
                elif response in ['n', 'no']:
                    print("\nRegenerating...")
                    attempt_num += 1
                    break
                else:
                    print("Please enter 'y' or 'n'")

            if advance_to_next_day:
                break

        # The next day excludes this board's words, so its tries must be rebuilt.
        if pool is not None:
            pool.terminate()

        if advance_to_next_day:
            continue


if __name__ == '__main__':
    main()


