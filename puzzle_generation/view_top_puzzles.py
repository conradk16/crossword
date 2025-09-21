import argparse
import json
from pathlib import Path
from typing import Any, Dict, List, Optional


def load_top_puzzles(jsonl_path: Path, limit: int) -> List[Dict[str, Any]]:
	"""Load the first `limit` non-empty JSONL lines as puzzles.

	Each line is expected to be a JSON object with at least `puzzle_date` and `data`.
	"""
	if not jsonl_path.exists():
		raise FileNotFoundError(f"File not found: {jsonl_path}")

	puzzles: List[Dict[str, Any]] = []
	with jsonl_path.open("r", encoding="utf-8") as f:
		for line in f:
			line = line.strip()
			if not line:
				continue
			try:
				puzzle = json.loads(line)
				puzzles.append(puzzle)
				if len(puzzles) >= limit:
					break
			except json.JSONDecodeError:
				# Skip malformed lines but continue reading
				continue

	return puzzles


def render_grid(grid: List[List[Optional[str]]]) -> str:
	"""Render the 2D grid as text with '#' for black squares."""
	rendered_rows: List[str] = []
	for row in grid:
		rendered_cells = [(cell if cell is not None else "#") for cell in row]
		rendered_rows.append(" ".join(rendered_cells))
	return "\n".join(rendered_rows)


def format_clue(clue_obj: Dict[str, Any]) -> str:
	clue_text = str(clue_obj.get("clue", ""))
	direction = str(clue_obj.get("direction", "")).lower()
	row = clue_obj.get("row")
	col = clue_obj.get("col")
	length = clue_obj.get("length")
	# Convert to 1-based indices for display if values are present
	if isinstance(row, int):
		row_disp = row + 1
	else:
		row_disp = row
	if isinstance(col, int):
		col_disp = col + 1
	else:
		col_disp = col
	coords = f"(r{row_disp},c{col_disp},len{length})" if row is not None and col is not None and length is not None else ""
	return f"- {clue_text} {coords}".rstrip()


def print_puzzle(index_one_based: int, puzzle: Dict[str, Any]) -> None:
	puzzle_date = puzzle.get("puzzle_date", "(no date)")
	data = puzzle.get("data", {})
	grid = data.get("grid", [])
	clues = data.get("clues", [])

	print(f"Puzzle {index_one_based} — {puzzle_date}")
	print("=" * (len(f"Puzzle {index_one_based} — {puzzle_date}")))
	if isinstance(grid, list) and grid:
		print(render_grid(grid))
	else:
		print("(no grid)")

	if isinstance(clues, list) and clues:
		across = [c for c in clues if str(c.get("direction", "")).lower() == "across"]
		down = [c for c in clues if str(c.get("direction", "")).lower() == "down"]
		if across:
			print("\nAcross:")
			for c in across:
				print(format_clue(c))
		if down:
			print("\nDown:")
			for c in down:
				print(format_clue(c))
	else:
		print("\n(no clues)")


def main() -> None:
	parser = argparse.ArgumentParser(description="View the top puzzles from a JSONL file in text form.")
	parser.add_argument("--file", "-f", default="puzzles.jsonl", help="Path to puzzles JSONL file (default: puzzles.jsonl in this directory)")
	parser.add_argument("--limit", "-n", type=int, default=3, help="Number of puzzles to show (default: 3)")
	args = parser.parse_args()

	jsonl_path = Path(args.file)
	if not jsonl_path.is_absolute():
		# Resolve relative to this script's directory by default
		jsonl_path = (Path(__file__).parent / jsonl_path).resolve()

	puzzles = load_top_puzzles(jsonl_path, limit=max(1, args.limit))
	if not puzzles:
		print("No puzzles found.")
		return

	for idx, puzzle in enumerate(puzzles, start=1):
		if idx > 1:
			print("\n" + ("-" * 40) + "\n")
		print_puzzle(idx, puzzle)


if __name__ == "__main__":
	main()


