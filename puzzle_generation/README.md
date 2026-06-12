puzzle generation works in three phases, all of which are intended to be run locally. The lack of pipeline here is because puzzle creation is (more or less) a one-time thing.

1. `generate_boards.py` grabs from `filtered_words.txt`, filters out words in `conrads_exclusions.txt`, and generates boards for a date range. Writes to local db.

2. `generate_full_board_clues.py` generates clues for a date range and writes to local db.

3. Manual work: For each day generated, use `print_puzzles.py` to print out the local daily puzzle. Paste the lines for clues you don't like (straight from `print_puzzles.py` output) into `clues_to_overwrite.csv`, edit the clue text, and run `overwrite_board_clues.py`. call `print_puzzles.py` again to verify. Repeat this process until satisfied, then call `promote_to_tier.py` to promote to prod.
