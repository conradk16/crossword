import json
import os
import re
import sys
import time
import random
from typing import Dict, List, Optional, Tuple

from openai import OpenAI


BATCH_COMPLETION_WINDOW = "24h"
STATE_FILENAME = "batch_state.json"
INPUT_JSONL_FILENAME = "batch_input.jsonl"
OUTPUT_JSONL_FILENAME = "batch_output.jsonl"

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


def is_candidate_word(word: str, score: int) -> bool:
    """Return True if word meets constraints: 3-7 letters, alpha-only, score >= 60."""
    if score < 60:
        return False
    if not (3 <= len(word) <= 7):
        return False
    return True


def build_prompt(target: str) -> str:
    return (
        "Would the average 12th grader know what the following word or phrase means? "
        "All possible two-word splits to form phrases are allowed, so find the most likely split (or no split) "
        "and then decide if a 12th grader would know the meaning. If really unsure, say no. "
        "Additionally, say no to words/phrases that are not appropriate for children. "
        "Finally, output 1 for yes, 0 for no. word/phrase: "
        f"{target}"
    )


def call_openai(api_key: str, prompt: str, model: str) -> bool:
    """
    Legacy single-request helper (unused in batch flow). Retained for reference.
    Returns bool verdict; returns False on error.
    """
    try:
        if api_key and not os.environ.get("OPENAI_API_KEY"):
            os.environ["OPENAI_API_KEY"] = api_key

        client = OpenAI()
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
                            "response_value": {
                                "type": "string",
                                "description": "Final output: 1 means yes, 0 means no",
                                "enum": ["1", "0"],
                            }
                        },
                        "additionalProperties": False,
                        "required": ["response_value"],
                    },
                }
            },
        )

        try:
            data = json.loads(response.output_text)
            value = data.get("response_value")
            return value == "1"
        except Exception:
            return False
    except Exception as error:
        print(f"Error calling OpenAI: {error}", file=sys.stderr)
        return False


def interpret_binary_response(text: str) -> Optional[bool]:
    """
    Interpret the response text as a binary yes/no based on the LAST digit.
    Returns True for last '1', False for last '0', or None if neither found.
    """
    if not text:
        return None

    for ch in reversed(text.strip()):
        if ch == '1':
            return True
        if ch == '0':
            return False

    return None


def _load_state(state_path: str) -> Optional[Dict[str, object]]:
    if not os.path.exists(state_path):
        return None
    try:
        with open(state_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _save_state(state_path: str, state: Dict[str, object]) -> None:
    with open(state_path, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, sort_keys=True)


def _generate_candidates(xwordlist_path: str) -> List[str]:
    entries = parse_xwordlist(xwordlist_path)
    random.shuffle(entries)
    candidates: List[str] = [word for (word, score) in entries if is_candidate_word(word, score)]
    return candidates[:max(0, 100)]


def _write_input_jsonl(input_path: str, words: List[str], model: str) -> int:
    """
    Create JSONL with one line per request targeting /v1/responses.
    Each line includes a custom_id embedding the word for mapping results.
    Returns number of lines written.
    """
    schema = {
        "type": "object",
        "properties": {
            "response_value": {
                "type": "string",
                "description": "Final output: 1 means yes, 0 means no",
                "enum": ["1", "0"],
            }
        },
        "additionalProperties": False,
        "required": ["response_value"],
    }

    lines_written = 0
    with open(input_path, "w", encoding="utf-8") as out:
        for word in words:
            prompt = build_prompt(word)
            body = {
                "model": model,
                "input": [{"role": "user", "content": prompt}],
                "text": {
                    "format": {
                        "type": "json_schema",
                        "name": "response_schema",
                        "strict": True,
                        "schema": schema,
                    }
                },
            }

            record = {
                "custom_id": f"word:{word}",
                "method": "POST",
                "url": "/v1/responses",
                "body": body,
            }
            out.write(json.dumps(record, ensure_ascii=False) + "\n")
            lines_written += 1

    return lines_written


def _start_batch(base_dir: str, model: str) -> None:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print(
            "Error: OPENAI_API_KEY not found. Set it in environment or add to puzzle_generation/.env as OPENAI_API_KEY=...",
            file=sys.stderr,
        )
        sys.exit(1)

    xwordlist_path = os.path.join(base_dir, "xwordlist.dict")
    try:
        words = _generate_candidates(xwordlist_path)
    except FileNotFoundError as fnf:
        print(str(fnf), file=sys.stderr)
        sys.exit(1)

    if not words:
        print("No candidates found with the given constraints (3-7 letters, score >= 70).")
        sys.exit(0)

    print(f'Num words: {len(words)}')

    input_path = os.path.join(base_dir, INPUT_JSONL_FILENAME)
    total = _write_input_jsonl(input_path, words, model)
    print(f"Prepared {total} batch requests → {input_path}")

    client = OpenAI()
    with open(input_path, "rb") as f:
        file_obj = client.files.create(file=f, purpose="batch")

    batch = client.batches.create(
        input_file_id=file_obj.id,
        endpoint="/v1/responses",
        completion_window=BATCH_COMPLETION_WINDOW,
        metadata={"job": "xword_filter", "model": model},
    )

    state = {
        "batch_id": batch.id,
        "input_file_id": file_obj.id,
        "model": model,
        "created_at": int(time.time()),
        "input_path": input_path,
        "base_dir": base_dir,
        "num_requests": total,
    }
    _save_state(os.path.join(base_dir, STATE_FILENAME), state)

    print(f"Batch created: {batch.id}")
    print("Use 'check_status' to monitor and 'retrieve' when completed.")


def _check_status(base_dir: str) -> None:
    state_path = os.path.join(base_dir, STATE_FILENAME)
    state = _load_state(state_path)
    if not state or "batch_id" not in state:
        print("No batch state found. Run with 'start' first.", file=sys.stderr)
        sys.exit(1)

    client = OpenAI()
    batch = client.batches.retrieve(state["batch_id"])  # type: ignore[index]
    print(batch)
    quit()

    # Update state with any new info
    if getattr(batch, "output_file_id", None):
        state["output_file_id"] = batch.output_file_id  # type: ignore[attr-defined]
    if getattr(batch, "error_file_id", None):
        state["error_file_id"] = batch.error_file_id  # type: ignore[attr-defined]
    _save_state(state_path, state)

    # Print a concise status summary
    status = getattr(batch, "status", "unknown")
    total = getattr(batch, "request_counts", {}).get("total", state.get("num_requests"))
    completed = getattr(batch, "request_counts", {}).get("completed", None)
    failed = getattr(batch, "request_counts", {}).get("failed", None)
    print(f"Batch {batch.id} status: {status}")
    if total is not None:
        print(f"- total: {total}")
    if completed is not None:
        print(f"- completed: {completed}")
    if failed is not None:
        print(f"- failed: {failed}")
    if "output_file_id" in state:
        print(f"- output_file_id: {state['output_file_id']}")
    if "error_file_id" in state:
        print(f"- error_file_id: {state['error_file_id']}")


def _retrieve_results(base_dir: str) -> None:
    state_path = os.path.join(base_dir, STATE_FILENAME)
    state = _load_state(state_path)
    if not state or "batch_id" not in state:
        print("No batch state found. Run with 'start' first.", file=sys.stderr)
        sys.exit(1)

    client = OpenAI()
    batch = client.batches.retrieve(state["batch_id"])  # type: ignore[index]
    status = getattr(batch, "status", "unknown")
    if status != "completed":
        print(f"Batch not completed yet. Current status: {status}")
        sys.exit(2)

    output_file_id = getattr(batch, "output_file_id", None)
    if not output_file_id:
        print("Completed batch has no output_file_id.", file=sys.stderr)
        sys.exit(3)

    # Download output jsonl
    out_jsonl_path = os.path.join(base_dir, OUTPUT_JSONL_FILENAME)
    try:
        content_stream = client.files.content(output_file_id)
        # Handle both file-like and HTTP response-like objects
        binary = None
        if hasattr(content_stream, "read"):
            binary = content_stream.read()
        elif hasattr(content_stream, "content"):
            binary = content_stream.content  # type: ignore[attr-defined]
        elif hasattr(content_stream, "text"):
            binary = content_stream.text.encode("utf-8")  # type: ignore[attr-defined]
        else:
            # Try to stringify
            binary = bytes(str(content_stream), "utf-8")
        with open(out_jsonl_path, "wb") as f:
            f.write(binary)
    except Exception as error:
        print(f"Failed to download output file: {error}", file=sys.stderr)
        sys.exit(4)

    # Parse results and write filtered_words.txt
    accepted_words: List[str] = []
    try:
        with open(out_jsonl_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except Exception:
                    continue

                custom_id = rec.get("custom_id") or rec.get("id")
                if not custom_id or not isinstance(custom_id, str):
                    continue

                # Expect custom_id like "word:<word>"
                word = None
                if custom_id.startswith("word:"):
                    word = custom_id.split(":", 1)[1]

                resp = rec.get("response") or {}
                body = (resp.get("body") if isinstance(resp, dict) else None) or {}

                output_text = body.get("output_text")
                verdict: Optional[bool] = None
                if isinstance(output_text, str) and output_text:
                    try:
                        parsed = json.loads(output_text)
                        value = parsed.get("response_value")
                        if value in ("1", "0"):
                            verdict = value == "1"
                    except Exception:
                        verdict = interpret_binary_response(output_text)
                else:
                    # Fallback: try to interpret from any stringified body
                    try:
                        verdict = interpret_binary_response(json.dumps(body))
                    except Exception:
                        verdict = None

                if verdict is True and word:
                    accepted_words.append(word)
    except Exception as error:
        print(f"Failed parsing output JSONL: {error}", file=sys.stderr)
        sys.exit(5)

    output_path = os.path.join(base_dir, "filtered_words.txt")
    with open(output_path, "w", encoding="utf-8") as out:
        for w in accepted_words:
            out.write(f"{w}\n")

    print(f"Done. Accepted {len(accepted_words)} words.")
    print(f"Wrote results to: {output_path}")


def main() -> None:
    base_dir = os.path.dirname(os.path.abspath(__file__))
    # Simple CLI: filter_words_openai.py <start|check_status|retrieve>
    if len(sys.argv) != 2 or sys.argv[1] not in {"start", "check_status", "retrieve"}:
        print("Usage: python filter_words_openai.py <start|check_status|retrieve>", file=sys.stderr)
        sys.exit(64)

    model = os.environ.get("OPENAI_MODEL")

    command = sys.argv[1]
    if command == "start":
        _start_batch(base_dir, model)
    elif command == "check_status":
        _check_status(base_dir)
    elif command == "retrieve":
        _retrieve_results(base_dir)


if __name__ == "__main__":
    main()
