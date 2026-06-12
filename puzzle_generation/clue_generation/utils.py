from typing import List, Dict
import os
import json

ANTHROPIC_MODEL = "claude-opus-4-7"


def generate_clues_for_words(
    words: List[str],
    prompt_suffix: str = "",
    use_anthropic: bool = False,
) -> Dict[str, str]:
    """Generate crossword clues for a list of words using structured outputs.

    Args:
        words: List of answer words to clue.
        prompt_suffix: Optional text to insert between the prompt prefix and the word list.
        use_anthropic: If True, use Anthropic (Opus 4.7); otherwise use OpenAI.

    Returns:
        Dict mapping each input word to its generated clue.
    """
    if not words:
        return {}

    # Ensure unique words while preserving order
    seen: Dict[str, None] = {}
    unique_words: List[str] = []
    for w in words:
        if not isinstance(w, str):
            continue
        key = w.strip()
        if not key:
            continue
        if key not in seen:
            seen[key] = None
            unique_words.append(key)

    if not unique_words:
        return {}

    # Reuse the same editorial instructions used in generate_puzzles.py
    instructions = (
        "You are a crossword editor. Create one clue per entry for a crossword puzzle. "
        "\nFollow American crossword conventions: question mark for double-meanings, fill-in-the-blanks, say/for example/for one/ e.g., abbreviated clues with \' . \' for abbreviated words, foreign language clue for foreign language word, quotations for expressions, no answer in clue, etc. "
        "\nFor each entry, do the following: "
        "\n1. Write out 10 distinct clues, sometimes utilizing the crossword conventions listed above. "
        "\n2. Go through them one by one, and answer each of these questions to determine if it should be eliminated: (yes, this may take some time)"
        "\n\ta. Does the clue really make sense? "
        "\n\tb. Are there words or references that too many people won't know? "
        "\n\tc. Does the clue contain part of the answer directly in it? (not allowed) "
        "\n3. Choose one from the remaining options, mixing things up between more straightforward and clever. Also, try to avoid doing too many one-word clues. "
        "\n4. Determine if the clue works grammatically, i.e. does the clue tense or plurality match the answer? If not, adjust it before submitting. "
    )

    # maybe use later: "Style: keep Monday-easy; avoid niche trivia."

    # Prepare entries where the id is the word itself
    compact_entries = [
        {
            'id': word,
            'answer': word,
            'direction': 'across',
            'length': len(word),
        }
        for word in unique_words
    ]

    # Structured output schema identical in spirit to generate_puzzles.py
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

    # Suffix sits between the instructions and the entries list
    suffix_block = ("\n\n" + prompt_suffix.strip() + "\n\n") if prompt_suffix and prompt_suffix.strip() else "\n\n"
    prompt = (
        f"{instructions}" +
        suffix_block +
        "Entries (JSON):\n" + json.dumps(compact_entries, ensure_ascii=False)
    )

    if use_anthropic:
        data = _call_anthropic(prompt, schema)
    else:
        data = _call_openai(prompt, schema)

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

    # Verify that we have a clue for each requested word
    missing = [w for w in unique_words if w not in id_to_clue]
    if missing:
        raise RuntimeError(
            f"Missing clues for words: {', '.join(missing[:5])}{'...' if len(missing) > 5 else ''}"
        )

    return id_to_clue


def _call_openai(prompt: str, schema: Dict[str, object]) -> dict:
    from openai import OpenAI

    api_key = os.environ.get('OPENAI_API_KEY')
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set.")

    model = os.environ.get('OPENAI_CLUE_MODEL')
    reasoning_effort = os.environ.get('OPENAI_REASONING_EFFORT', 'high')

    client = OpenAI()

    try:
        response = client.responses.create(
            model=model,
            input=[{"role": "user", "content": prompt}],
            reasoning={"effort": reasoning_effort},
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

    try:
        usage = getattr(response, 'usage', None)
        out_tokens = getattr(usage, 'output_tokens', None) if usage is not None else None
        if out_tokens is not None:
            print(f"Clue generation output tokens: {out_tokens}")
    except Exception:
        pass

    try:
        return json.loads(response.output_text)
    except Exception as e:
        raise RuntimeError(f"Failed to parse OpenAI structured output: {e}")


def _call_anthropic(prompt: str, schema: Dict[str, object]) -> dict:
    import anthropic

    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set.")

    client = anthropic.Anthropic()

    tool = {
        "name": "submit_clues",
        "description": "Submit the chosen clue for each crossword entry.",
        "input_schema": schema,
    }

    try:
        response = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=20000,
            tools=[tool],
            messages=[{"role": "user", "content": prompt}],
            thinking={"type": "adaptive"},
            output_config={"effort": "max"},
        )
    except Exception as e:
        raise RuntimeError(f"Anthropic call failed: {e}")

    try:
        usage = getattr(response, 'usage', None)
        out_tokens = getattr(usage, 'output_tokens', None) if usage is not None else None
        if out_tokens is not None:
            print(f"Clue generation output tokens: {out_tokens}")
    except Exception:
        pass

    for block in response.content:
        if getattr(block, "type", None) == "tool_use" and getattr(block, "name", None) == "submit_clues":
            return block.input

    raise RuntimeError("Anthropic response missing tool_use 'submit_clues' block.")
