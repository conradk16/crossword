puzzle generation works in three phases, all of which are intended to be run locally. The lack of pipeline here is because puzzle creation is (more or less) a one-time thing.

Phase 1: `filter_words.py` grabs words from `xwordlist.dict`, asks chatgpt if they are relatively understandable, and writes them to `filtered_words.txt`. `filter_words_simple.py` skips the "ask chatgpt" step for quicker development. `filter_words.py` also has three settings (`start`, `check_status`, and `retrieve`) for handling the batch nature of the Openai API requests.

Phase 2: `generate_puzzles.py` grabs words from `filtered_words.txt`, generates daily puzzles for some number of days into the future, and writes the puzzles to `puzzles.jsonl`. This script uses `templates.txt` for the daily templates, and synchronously calls the OpenAI API for clue generation.

Phase 3: `upload_puzzles.py` grabs `puzzles.jsonl` and writes to the database via the `/api/admin/puzzles/bulk` endpoint in the nextjs app using a special admin key.
