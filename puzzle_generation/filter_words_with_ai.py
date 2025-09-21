import json
import os
import random
import sys
import time
from typing import List, Optional, Tuple

from openai import OpenAI
from concurrent.futures import ThreadPoolExecutor, as_completed


def parse_simple_wordlist(file_path: str) -> List[str]:
    """
    Parse a simple newline-delimited word list.
    Each non-empty, non-comment line is treated as a word. Returns lowercase words.
    """
    results: List[str] = []
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"simple word list not found: {file_path}")

    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            results.append(line.lower())

    return results

def build_batch_prompt(targets: List[str]) -> str:
    return (
        "You will be given a list of crossword entries. For each entry, answer whether a teenager who grew up in the 21st century would likely know the meaning. "
        "Some entries contain multiple words without spaces, so consider those possibilities. "
        "Also mark entries that are not appropriate for children as no. "
        "Return only JSON with key 'responses' as an array of strings, where each element is '1' for yes or '0' for no, corresponding to the inputs in the same order.\n\n"
        "Entries:\n"
        + "\n".join(f"- {w}" for w in targets)
    )


def evaluate_batch(client: OpenAI, prompt: str, model: str, expected_count: int) -> Tuple[Optional[List[bool]], int]:
    """
    Call the Responses API synchronously for a batch prompt and return:
      - verdicts: List[True/False] of length expected_count, or None if cannot be interpreted
      - output_tokens: tokens counted as output by the model (0 if unavailable)
    """
    try:
        response = client.responses.create(
            model=model,
            input=[{"role": "user", "content": prompt}],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "response_schema",
                    "strict": True,
                    "schema": {
                        "type": "object",
                        "properties": {
                            "responses": {
                                "type": "array",
                                "items": {"type": "string", "enum": ["1", "0"]},
                                "minItems": expected_count,
                                "maxItems": expected_count,
                                "description": "Array of '1' or '0' strings in the same order as inputs",
                            }
                        },
                        "additionalProperties": False,
                        "required": ["responses"],
                    },
                }
            },
        )

        # Extract output token usage if available
        output_tokens = 0
        usage = getattr(response, "usage", None)
        if usage is not None:
            output_tokens = (
                getattr(usage, "output_tokens", None)
                or getattr(usage, "completion_tokens", None)
                or 0
            )

        try:
            data = json.loads(response.output_text)
            responses = data.get("responses")
            if isinstance(responses, list) and len(responses) == expected_count:
                verdicts: List[bool] = [(v == "1") for v in responses]
                return (verdicts, int(output_tokens))
        except Exception:
            print('model output not a valid array of "1"/"0"')
            pass

    except Exception:
        print('error calling model')
        return (None, 0)


def run_sync(base_dir: str, model: str, limit: Optional[int] = None, batch_size: int = 20) -> None:
    api_key = os.environ.get("OPENAI_API_KEY")

    wordlist_path = os.path.join(base_dir, "filtered_words_simple.txt")
    try:
        words = parse_simple_wordlist(wordlist_path)
    except FileNotFoundError as fnf:
        print(str(fnf), file=sys.stderr)
        sys.exit(1)
    
    random.seed(20)
    random.shuffle(words)
    if limit is not None:
        words = words[: max(0, limit)]

    print(
        f"Evaluating {len(words)} words with model: {model} in batches of {batch_size} (up to 20 batches in parallel)"
    )

    accepted_words: List[str] = []

    # Prepare batches
    batches: List[Tuple[int, List[str]]] = []
    for start in range(0, len(words), batch_size):
        batch_index = start // batch_size
        batch_words = words[start : start + batch_size]
        batches.append((batch_index, batch_words))

    # Worker to process a single batch with simple retries
    def process_batch(batch_index: int, batch_words: List[str]) -> Tuple[int, List[str], Optional[List[bool]], int]:
        client = OpenAI()
        prompt = build_batch_prompt(batch_words)
        verdicts: Optional[List[bool]] = None
        attempts = 0
        output_tokens = 0
        while attempts < 3 and verdicts is None:
            attempts += 1
            verdicts, output_tokens = evaluate_batch(
                client, prompt, model, expected_count=len(batch_words)
            )
            if verdicts is None:
                time.sleep(0.75 * attempts)
        return (batch_index, batch_words, verdicts, output_tokens)

    # Execute up to 20 batches in parallel
    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = [executor.submit(process_batch, idx, batch) for idx, batch in batches]
        for future in as_completed(futures):
            batch_index, batch_words, verdicts, output_tokens = future.result()
            print(f'batch tokens used: {output_tokens}')
            if verdicts is None:
                print(f'failed to get verdicts for batch {batch_index}')
                print()
                continue
            for word, verdict in zip(batch_words, verdicts):
                print(f'word: {word}: accepted: {verdict}')
                if verdict is True:
                    accepted_words.append(word)
            print()


    output_path = os.path.join(base_dir, "filtered_words.txt")
    with open(output_path, "w", encoding="utf-8") as out:
        for w in accepted_words:
            out.write(f"{w}\n")

    print(f"Done. Accepted {len(accepted_words)} words.")
    print(f"Wrote results to: {output_path}")


def main() -> None:
    base_dir = os.path.dirname(os.path.abspath(__file__))

    model = os.environ.get("OPENAI_SCORING_MODEL")

    limit: Optional[int] = None
    batch_size: int = 10
    if len(sys.argv) == 2:
        try:
            limit = int(sys.argv[1])
        except ValueError:
            print("Usage: python filter_words_with_ai_sync.py [optional_limit] [optional_batch_size]", file=sys.stderr)
            sys.exit(64)
    elif len(sys.argv) == 3:
        try:
            limit = int(sys.argv[1])
            batch_size = int(sys.argv[2])
        except ValueError:
            print("Usage: python filter_words_with_ai_sync.py [optional_limit] [optional_batch_size]", file=sys.stderr)
            sys.exit(64)
    elif len(sys.argv) > 3:
        print("Usage: python filter_words_with_ai_sync.py [optional_limit] [optional_batch_size]", file=sys.stderr)
        sys.exit(64)

    run_sync(base_dir, model, limit, batch_size)


if __name__ == "__main__":
    main()


