import os
import re
import sys
from typing import List, Optional, Tuple


def parse_xwordlist(file_path: str) -> List[Tuple[str, int]]:
    """
    Parse xwordlist.dict.
    Primary format: "WORD;SCORE".
    Fallback format: "word <whitespace> score".
    Returns list of (word_lowercase, score_int). Non-parseable lines are skipped.
    """
    results: List[Tuple[str, int]] = []
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"xwordlist file not found: {file_path}")

    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue

            word_token: Optional[str] = None
            score_value: Optional[int] = None

            if ";" in line:
                parts = line.split(";")
                if len(parts) >= 2:
                    candidate_word = parts[0].strip()
                    candidate_score = parts[1].strip()
                    if re.fullmatch(r"\d+", candidate_score):
                        try:
                            score_value = int(candidate_score)
                            word_token = candidate_word
                        except ValueError:
                            pass
            else:
                parts = line.split()
                if len(parts) >= 2:
                    candidate_word = parts[0].strip()
                    candidate_score = parts[-1].strip()
                    if re.fullmatch(r"\d+", candidate_score):
                        try:
                            score_value = int(candidate_score)
                            word_token = candidate_word
                        except ValueError:
                            pass

            if word_token is None or score_value is None:
                continue

            word_clean = word_token.strip()
            if not word_clean:
                continue

            results.append((word_clean.lower(), score_value))

    return results


def is_valid(word: str, score: int) -> bool:
    """3–7 letters, alpha-only, and score > 60."""
    if score <= 60:
        return False
    if not (3 <= len(word) <= 7):
        return False
    if not word.isalpha():
        return False
    return True


def main() -> None:
    base_dir = os.path.dirname(os.path.abspath(__file__))
    xwordlist_path = os.path.join(base_dir, "xwordlist.dict")
    output_path = os.path.join(base_dir, "filtered_words.txt")

    try:
        entries = parse_xwordlist(xwordlist_path)
    except FileNotFoundError as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)

    seen = set()
    filtered_words: List[str] = []
    for word, score in entries:
        if is_valid(word, score) and word not in seen:
            filtered_words.append(word)
            seen.add(word)

    with open(output_path, "w", encoding="utf-8") as out:
        for w in filtered_words:
            out.write(f"{w}\n")

    print(f"Wrote {len(filtered_words)} words to {output_path}")


if __name__ == "__main__":
    main()


