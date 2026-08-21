"""Lenient JSON extraction from LLM output (Epic 8 Sprint 2).

Pure, dependency-free. Extracted from core.py; core re-exports `_extract_json`
so existing callers are unchanged. Handles ```json fenced blocks and prose that
wraps a single JSON object, then falls back to json.loads on the trimmed text.
"""
import json


def _extract_json(text: str):
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1] if text.count("```") >= 2 else text.strip("`")
        if text.lstrip().startswith("json"):
            text = text.lstrip()[4:]
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        text = text[start:end + 1]
    return json.loads(text)
