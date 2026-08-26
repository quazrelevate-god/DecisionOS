"""Prompt registry core (Epic 3 Sprint 1 -- AI Foundation).

Every system prompt in DecisionOS lives here as a named, versioned ``Prompt``
instead of an inline string buried in a service function. That makes the whole
prompt surface reviewable in one place, diff-able across versions, and swappable
without touching business logic.

Placeholders use ``string.Template`` ``$name`` / ``${name}`` syntax -- NOT
``str.format`` -- because the prompts are full of literal JSON braces
(``{"summary": ...}``) that would break ``.format``. A literal ``$`` in a
template must be written ``$$``.

Usage:
    from prompts import render
    system = render("extraction.extract", roles_str=..., cat_desc=..., ...)
"""
from dataclasses import dataclass
from string import Template


@dataclass(frozen=True)
class Prompt:
    """A single named, versioned prompt template.

    name:     dotted id, ``<domain>.<key>`` (e.g. ``extraction.extract``).
    version:  bump when the wording changes so telemetry/evals can attribute
              an output to the exact prompt that produced it.
    intent:   one line -- what this prompt is for (shown in registry listings).
    template: the prompt text, with ``$name`` / ``${name}`` placeholders.
    """
    name: str
    version: str
    intent: str
    template: str

    def render(self, **vars) -> str:
        """Substitute placeholders. Strict: a missing/extra var raises, so a
        prompt/caller drift is caught immediately rather than shipping a broken
        prompt. Call with no vars for a static prompt."""
        if not vars:
            return self.template
        return Template(self.template).substitute(**vars)


_REGISTRY: dict[str, Prompt] = {}


def register(p: Prompt) -> Prompt:
    if p.name in _REGISTRY:
        raise ValueError(f"duplicate prompt name in registry: {p.name}")
    _REGISTRY[p.name] = p
    return p


def get(name: str) -> Prompt:
    try:
        return _REGISTRY[name]
    except KeyError:
        raise KeyError(f"unknown prompt: {name!r} (registered: {sorted(_REGISTRY)})")


def render(name: str, **vars) -> str:
    """Convenience: fetch + render in one call."""
    return get(name).render(**vars)


def all_prompts() -> dict[str, Prompt]:
    """A copy of the registry -- for the telemetry/eval/admin surfaces."""
    return dict(_REGISTRY)
