import os
import re
import sys
from typing import List, Optional, Tuple, Set

# returns list of (word, score) pairs
def parse_xwordlist(file_path: str) -> List[Tuple[str, int]]:
    results: List[Tuple[str, int]] = []
    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
        lines = f.read().splitlines()
    for line in lines:
        parts = line.split(";")
        results.append((parts[0].lower(), int(parts[1])))
    return results

def parse_broda_diehl_list(file_path: str) -> List[Tuple[str, int]]:
    results: List[Tuple[str, int]] = []
    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
        lines = f.read().splitlines()
    for line in lines:
        parts = line.split(";")
        results.append((parts[0].lower(), int(parts[1]) * 2))
    return results

def parse_xwordinfo_list(file_path: str) -> List[Tuple[str, int]]:
    results: List[Tuple[str, int]] = []
    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
        lines = f.read().splitlines()
    for line in lines:
        parts = line.split(";")
        results.append((parts[0].lower(), int(parts[1]) * 2))
    return results

def get_conrads_exclusions(file_path: str) -> Set[str]:
    with open(file_path) as f:
        lines = f.read().splitlines()
    return set(lines)

def is_valid(word: str, score: int) -> bool:
    if not word.isalpha():
        return False
    if 3 <= len(word) <= 7 and score >= 80:
        return True
    return False


def _scores_by_length(entries: List[Tuple[str, int]], min_len: int = 3, max_len: int = 7) -> dict:
    buckets: dict[int, List[int]] = {l: [] for l in range(min_len, max_len + 1)}
    for word, score in entries:
        word_len = len(word)
        if min_len <= word_len <= max_len:
            buckets[word_len].append(score)
    return buckets


def _print_score_histogram(scores: List[int], title: str) -> None:
    print(title)
    if not scores:
        print("  (no data)\n")
        return
    # Decile buckets of width 10: 0-9, 10-19, ..., up to max
    max_bucket = max(s // 10 for s in scores)
    bucket_counts: List[int] = [0] * (max_bucket + 1)
    for s in scores:
        bucket_counts[s // 10] += 1
    max_count = max(bucket_counts) if bucket_counts else 0
    for b_idx, count in enumerate(bucket_counts):
        low = b_idx * 10
        high = b_idx * 10 + 9
        label = f"{low:>3}-{high:<3}"
        if max_count > 0:
            bar_len = max(1, int(round((count / max_count) * 50))) if count > 0 else 0
        else:
            bar_len = 0
        bar = "#" * bar_len
        print(f"  {label} | {bar} ({count})")
    print()


def print_length_score_histograms(entries: List[Tuple[str, int]], dataset_label: str) -> None:
    by_len = _scores_by_length(entries, 3, 7)
    for l in range(3, 8):
        title = f"Histogram for {dataset_label} — word length {l}"
        _print_score_histogram(by_len.get(l, []), title)


def main() -> None:
    base_dir = os.path.dirname(os.path.abspath(__file__))
    xwordlist_path = os.path.join(base_dir, "lists/xwordlist.txt")
    broda_diehl_path = os.path.join(base_dir, "lists/broda_diehl_list.txt")
    xwordinfo_path = os.path.join(base_dir, "lists/xwi_list.txt")
    output_path = os.path.join(base_dir, "filtered_words_simple.txt")
    conrads_exclusions_path = os.path.join(base_dir, "lists/conrads_exclusions.txt")

    xwordlist_entries = parse_xwordlist(xwordlist_path)
    broda_diehl_entries = parse_broda_diehl_list(broda_diehl_path)
    xwordinfo_entries = parse_xwordinfo_list(xwordinfo_path)
    conrads_exclusions = get_conrads_exclusions(conrads_exclusions_path)

    # Print histograms before applying validity checks
    print_length_score_histograms(xwordlist_entries, "Xwordlist")
    print_length_score_histograms(broda_diehl_entries, "Broda-Diehl")
    print_length_score_histograms(xwordinfo_entries, "XWordInfo")

    seen = set()
    filtered_words: List[str] = []
    for word, score in broda_diehl_entries + xwordlist_entries:
        if is_valid(word, score) and word not in seen and word not in conrads_exclusions:
            filtered_words.append(word)
            seen.add(word)

    with open(output_path, "w", encoding="utf-8") as out:
        for w in filtered_words:
            out.write(f"{w}\n")

    print(f"Wrote {len(filtered_words)} words to {output_path}")


if __name__ == "__main__":
    main()


