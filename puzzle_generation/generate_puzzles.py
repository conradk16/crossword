from typing import List, Dict, Set, Tuple
from collections import defaultdict
import random
import os
import re
import json
from datetime import datetime, timedelta
import argparse
from zoneinfo import ZoneInfo
from openai import OpenAI

class TrieNode:
    def __init__(self):
        self.children = {} # map from character to a TrieNode
        self.count = 0
        self.is_word_end = False

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

    # Temporarily disable a word by decrementing counts along its path
    def remove_word(self, word: str) -> None:
        current = self.root
        for c in word:
            if c not in current.children:
                return
            current.count -= 1
            current = current.children[c]
        current.count -= 1

    # returns a set of possible next characters that keep this prefix valid
    def is_valid_prefix(self, prefix: str) -> Set[str]:
        current = self.root
        for c in prefix:
            if c not in current.children:
                return set()
            current = current.children[c]
            if current.count == 0:
                return set()
        return set([key for key, value in current.children.items() if value.count > 0])

    # returns True if the given string is a complete word in the trie
    def is_word(self, word: str) -> bool:
        current = self.root
        for c in word:
            if c not in current.children:
                return False
            current = current.children[c]
        return current.is_word_end and current.count > 0

class Generator:
    def __init__(self):
        self.words = defaultdict(list) # map from length to list of words
        self.trie = Trie()
        self.exclusions: Set[str] = set()
        self._load_exclusions()
        self._load_words()

    def _load_exclusions(self) -> None:
        base_dir = os.path.dirname(__file__)
        exclusions_path = os.path.join(base_dir, 'lists', 'conrads_exclusions.txt')
        if not os.path.exists(exclusions_path):
            self.exclusions = set()
            return
        exclusions: Set[str] = set()
        with open(exclusions_path) as f:
            for raw_line in f:
                word = raw_line.strip().lower()
                if not word:
                    continue
                # Keep alphabetic words only, to match the main word list rule
                if not word.isalpha():
                    continue
                exclusions.add(word)
        self.exclusions = exclusions

    def _build_trie(self, max_length: int, min_length: int = 2) -> None:
        self.trie = Trie()
        for length, words in self.words.items():
            if length < min_length or length > max_length:
                continue
            for word in words:
                self.trie.add_word(word)

    def _load_words(self) -> None:
        base_dir = os.path.dirname(__file__)
        words_path = os.path.join(base_dir, 'filtered_words.txt')
        with open(words_path) as f:
            for raw_line in f:
                word = raw_line.strip().lower()
                if not word:
                    continue
                # keep alphabetic words only
                if not word.isalpha():
                    continue
                # exclude any words listed in conrads_exclusions.txt
                if word in self.exclusions:
                    continue
                self.words[len(word)].append(word)

    def fill_grid(self, rows: int, cols: int, black_squares: Set[Tuple[int, int]]) -> List[List[str]]:
        # Rebuild trie with words up to the maximum segment size for performance
        self._build_trie(max_length=max(rows, cols))

        grid: List[List[str]] = [[''] * cols for _ in range(rows)]
        used_words: Set[str] = set()

        # Order of filling: row-major, skipping blacks
        fill_positions: List[Tuple[int, int]] = []
        for r in range(rows):
            for c in range(cols):
                if (r, c) not in black_squares:
                    fill_positions.append((r, c))

        def is_black(r: int, c: int) -> bool:
            return (r, c) in black_squares

        def get_row_prefix(r: int, c: int) -> str:
            # from the previous cell leftwards until black or start
            start_c = c
            cc = c - 1
            while cc >= 0 and not is_black(r, cc):
                start_c = cc
                if grid[r][cc] == '':
                    break
                cc -= 1
            # Now build prefix from start_c to c-1
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
            # find start
            start_c = c
            cc = c - 1
            while cc >= 0 and not is_black(r, cc) and grid[r][cc] != '':
                start_c = cc
                cc -= 1
            # build
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
            possible_for_row = self.trie.is_valid_prefix(row_prefix)
            if not possible_for_row:
                return False
            possible_for_col = self.trie.is_valid_prefix(col_prefix)
            if not possible_for_col:
                return False

            possible = list(possible_for_row.intersection(possible_for_col))
            if not possible:
                return False
            random.shuffle(possible)

            for ch in possible:
                completed_words: List[str] = []
                # Check across completion
                if completes_across(r, c):
                    completed_row_word = build_completed_row_word(r, c, ch)
                    if not self.trie.is_word(completed_row_word):
                        continue
                    completed_words.append(completed_row_word)
                # Check down completion
                if completes_down(r, c):
                    completed_col_word = build_completed_col_word(r, c, ch)
                    if not self.trie.is_word(completed_col_word):
                        continue
                    completed_words.append(completed_col_word)

                # Prevent same word being formed twice at once (across and down identical)
                unique_completed = list(dict.fromkeys(completed_words))
                if len(unique_completed) != len(completed_words):
                    continue
                # Enforce no duplicates within the same puzzle
                if any(w in used_words for w in unique_completed):
                    continue

                grid[r][c] = ch
                # Temporarily remove completed words to prune prefixes
                for w in unique_completed:
                    self.trie.remove_word(w)
                    used_words.add(w)

                if backtrack(pos_index + 1):
                    return True

                # Undo
                for w in unique_completed:
                    self.trie.add_word(w)
                    used_words.remove(w)
                grid[r][c] = ''

            return False

        solved = backtrack(0)
        if not solved:
            return []
        return grid

def parse_templates(templates_path: str) -> List[Tuple[str, int, int, Set[Tuple[int, int]]]]:
    # Accept lines like:
    # Monday: 6x6, [(0,0), (5,0), (0,5), (5,5)]
    # Sunday, 5x5, []
    results: List[Tuple[str, int, int, Set[Tuple[int, int]]]] = []
    with open(templates_path) as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line:
                continue
            # Split into 3 parts: day, dims, blacks
            # Normalize colon/comma after day
            m = re.match(r"^([A-Za-z]+)[:|,]\s*(\d+)x(\d+),\s*(\[.*\])$", line)
            if not m:
                # fallback: try to parse in a more permissive way
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

            # Parse black squares list of tuples
            black_squares: Set[Tuple[int, int]] = set()
            if blacks_str and blacks_str != '[]':
                for tup in re.finditer(r"\((\d+)\s*,\s*(\d+)\)", blacks_str):
                    r, c = int(tup.group(1)), int(tup.group(2))
                    black_squares.add((r, c))

            results.append((day, rows, cols, black_squares))
    return results

def _compute_entries(rows: int, cols: int, black_squares: Set[Tuple[int, int]], final_grid: List[List[object]]) -> List[Dict[str, object]]:
    """Compute across and down entries with answers from the filled grid."""
    entries: List[Dict[str, object]] = []

    def is_black(r: int, c: int) -> bool:
        return (r, c) in black_squares

    # Across entries
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
                        'id': f"A_{r}_{c}",
                        'direction': 'across',
                        'row': r,
                        'col': c,
                        'length': length,
                        'answer': answer,
                    })
                c = end_c
            else:
                c += 1

    # Down entries
    for c in range(cols):
        r = 0
        while r < rows:
            if not is_black(r, c) and (r == 0 or is_black(r - 1, c)):
                end_r = r
                while end_r < rows and not is_black(end_r, c):
                    end_r += 1
                length = end_r - r
                if length >= 2:
                    letters: List[str] = []
                    for x in range(r, end_r):
                        val = final_grid[x][c]
                        letters.append(val if isinstance(val, str) else '')
                    answer = ''.join(letters)
                    entries.append({
                        'id': f"D_{r}_{c}",
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


def build_clues(rows: int, cols: int, black_squares: Set[Tuple[int, int]], final_grid: List[List[object]]) -> List[Dict[str, object]]:
    """Build structured clues using OpenAI Structured Outputs. Errors on failure."""
    entries = _compute_entries(rows, cols, black_squares, final_grid)
    if not entries:
        raise RuntimeError("No entries found to clue.")

    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set.")

    model = os.environ.get('OPENAI_CLUE_MODEL')

    compact_entries = [
        {
            'id': e['id'],
            'answer': e['answer'],
            'direction': e['direction'],
            'length': e['length'],
        }
        for e in entries
    ]

    schema: Dict[str, object] = {
        "type": "object",
        "additionalProperties": False,
        "required": ["clues"],
        "properties": {
            "clues": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["id", "clue"],
                    "properties": {
                        "id": {"type": "string"},
                        "clue": {"type": "string"},
                    },
                },
            }
        },
    }

    instructions = (
        "You are a crossword editor. Create one clue per entry for a crossword puzzle. "
        "\nFollow American crossword conventions: question mark for double-meanings, fill-in-the-blanks, say/for example/for one/ e.g., abbreviated clues with \'.\' for abbreviated words, foreign language clue for foreign language word, quotations for expressions, no answer in clue, etc. "
        "\nFor each entry, do the following: "
        "\n1. Write out 15 distinct clues, sometimes utilizing the crossword conventions listed above. "
        "\n2. Go through them one by one, and answer each of these questions to determine if it should be eliminated: (yes, this may take some time)"
        "\n\ta. Does the clue really make sense when you think hard about it? "
        "\n\tb. Are there words or references that too many people won't know? "
        "\n\tc. Is the clue too difficult? "
        "\n\td. Does the clue contain part of the answer directly in it? (not allowed) "
        "\n3. Choose one from the remaining options, usually choosing a normal good clue, but occasionally choosing a more clever one. Also, try to avoid doing too many one-word clues. "
        "\n4. Determine if the clue works grammatically, i.e. does the clue tense or plurality match the answer? If not, adjust it before submitting. "
    )

    client = OpenAI()
    prompt = (
        f"{instructions}\n\n"
        "Entries (JSON):\n" + json.dumps(compact_entries, ensure_ascii=False)
    )

    try:
        response = client.responses.create(
            model=model,
            input=[{"role": "user", "content": prompt}],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "clue_schema",
                    "strict": True,
                    "schema": schema,
                }
            },
        )
    except Exception as e:
        raise RuntimeError(f"OpenAI call failed: {e}")

    # Print number of output tokens used, if available
    try:
        usage = getattr(response, 'usage', None)
        out_tokens = getattr(usage, 'output_tokens', None) if usage is not None else None
        if out_tokens is not None:
            print(f"Clue generation output tokens: {out_tokens}")
    except Exception:
        pass

    try:
        data = json.loads(response.output_text)
    except Exception as e:
        raise RuntimeError(f"Failed to parse OpenAI structured output: {e}")

    if not isinstance(data, dict) or 'clues' not in data:
        raise RuntimeError("Structured output missing 'clues' field.")

    id_to_clue: Dict[str, str] = {}
    for item in data.get('clues') or []:
        if not isinstance(item, dict):
            continue
        eid = item.get('id')
        clue = item.get('clue')
        if isinstance(eid, str) and isinstance(clue, str) and clue.strip():
            id_to_clue[eid] = clue.strip()

    missing = [e['id'] for e in entries if e['id'] not in id_to_clue]
    if missing:
        raise RuntimeError(f"Missing clues for entries: {', '.join(missing[:5])}{'...' if len(missing) > 5 else ''}")

    clues: List[Dict[str, object]] = []
    for e in entries:
        clues.append({
            'clue': id_to_clue[e['id']],  # type: ignore[index]
            'direction': e['direction'],
            'row': e['row'],
            'col': e['col'],
            'length': e['length'],
        })

    return clues

if __name__ == '__main__':
    # Build template map by weekday name
    base_dir = os.path.dirname(__file__)
    templates_path = os.path.join(base_dir, 'templates.txt')
    parsed_templates = parse_templates(templates_path)
    template_by_day: Dict[str, Tuple[int, int, Set[Tuple[int, int]]]] = {}
    for day, rows, cols, blacks in parsed_templates:
        template_by_day[day] = (rows, cols, blacks)

    # build_clues moved to module scope for reuse

    # Prepare generator
    generator = Generator()

    # Determine today's date in America/Los_Angeles
    pacific = ZoneInfo('America/Los_Angeles')
    today_pacific = datetime.now(tz=pacific).date()

    # Parse command-line arguments
    parser = argparse.ArgumentParser(description='Generate crossword puzzles (starts tomorrow by default).')
    parser.add_argument('days', type=int,
                        help='Number of days to generate (starting tomorrow unless --include-today).')
    parser.add_argument('--include-today', action='store_true',
                        help='Include today as the first generated date (default: disabled).')
    args = parser.parse_args()
    num_days: int = args.days
    if num_days < 1:
        num_days = 0

    # Generate puzzles for the requested number of days
    out_path = os.path.join(base_dir, 'puzzles.jsonl')
    with open(out_path, 'w') as out_f:
        start_date = today_pacific if args.include_today else (today_pacific + timedelta(days=1))
        for day_index in range(num_days):
            d = start_date + timedelta(days=day_index)
            weekday_name = d.strftime('%A')
            print(f"Generating {d.isoformat()} ({weekday_name})...")
            if weekday_name not in template_by_day:
                # Skip if no template available for this weekday
                continue
            rows, cols, blacks = template_by_day[weekday_name]

            # Try multiple attempts to find a solution
            grid: List[List[str]] = []
            for attempt in range(20):
                # Vary seed per date and attempt to diversify search
                random.seed((hash(d.isoformat()) ^ attempt) & 0xFFFFFFFF)
                grid = generator.fill_grid(rows, cols, blacks)
                if grid:
                    break

            if not grid:
                # If no solution found, skip this date
                continue

            # Build final grid with nulls for black squares and uppercase letters
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

            clues = build_clues(rows, cols, blacks, final_grid)

            record = {
                'puzzle_date': d.isoformat(),
                'data': {
                    'grid': final_grid,
                    'clues': clues,
                }
            }

            out_f.write(json.dumps(record, ensure_ascii=False) + '\n')

