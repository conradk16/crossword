puzzle generation works in three phases, all of which are intended to be run locally. The lack of pipeline here is because puzzle creation is (more or less) a one-time thing.

1. `filter_words_simple.py` grabs words from `lists/xwordlist.txt` and `broda_diehl_list.txt`, checks the basic scores, and writes them to `filtered_words_simple.txt`.

2. `generate_boards.py` grabs from `filtered_words_simple.txt`, filters out words in `conrads_exclusions.txt`, and generates boards for a date range. Writes to `boards.jsonl`.

3. `upload_boards.py` grabs from `boards.jsonl` and uploads to a database (tier is an arg)

4. `generate_full_board_clues.py` generates clues for a date range and writes to `full_board_clues.jsonl`. Synchronously calls the OpenAI API for clue generation.

5. `upload_full_board_clues.py` uploads clues from `full_board_clues.jsonl` to the appropriate tier.

6. Manual work: For each day generated, use `print_puzzles.py` to print out the daily puzzle. Add clues you don't like to `clues_to_overwrite.csv` and run `generate_partial_board_clues.py`. Upload to local with `upload_partial_board_clues.py`, and call `print_puzzles.py` again. Repeat this process until satisfied, then upload to dev and then prod.
