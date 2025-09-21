puzzle generation works in three phases, all of which are intended to be run locally. The lack of pipeline here is because puzzle creation is (more or less) a one-time thing.

Phase 1: `filter_words_simple.py` grabs words from `lists/xwordlist.txt` and `broda_diehl_list.txt`, checks the basic scores, and writes them to `filtered_words_simple.txt`.

Phase 2: `filter_words_with_ai.py` grabs from `filtered_words_simple.txt`, asks AI if they are relatively understandable for a general audience, and writes to `filtered_words.txt`.

Phase 3: `generate_puzzles.py` grabs words from `filtered_words.txt`, generates daily puzzles for some number of days into the future, and writes the puzzles to `puzzles.jsonl`. This script uses `templates.txt` for the daily templates, and synchronously calls the OpenAI API for clue generation.

Phase 4: `upload_puzzles.py` grabs `puzzles.jsonl` and writes to the database via the `/api/admin/puzzles/bulk` endpoint in the nextjs app using a special admin key.
