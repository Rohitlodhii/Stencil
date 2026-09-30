"""Extract a single JSON object from an LLM reply (fences/prose tolerant)."""

from __future__ import annotations


class StructuredOutputError(ValueError):
    pass


def extract_json_object(text: str) -> dict:
    import json as _json
    import re as _re

    t = (text or "").strip()
    t = _re.sub(r"^```(?:json)?\s*", "", t)
    t = _re.sub(r"\s*```$", "", t)
    start = t.find("{")
    if start == -1:
        raise StructuredOutputError("ai did not return JSON")
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(t)):
        ch = t[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        else:
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        obj = _json.loads(t[start : i + 1])
                    except Exception as exc:
                        raise StructuredOutputError(f"ai returned bad JSON: {exc}")
                    if not isinstance(obj, dict):
                        raise StructuredOutputError("ai did not return a JSON object")
                    return obj
    try:
        obj = _json.loads(t[start:])
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass
    raise StructuredOutputError("ai did not return valid JSON")
