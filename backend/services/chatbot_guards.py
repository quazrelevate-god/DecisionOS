"""Chatbot guards — DETERMINISTIC relevance + prompt-injection classifiers.

Two pure functions, no LLM calls, no DB.

Both are intentionally REGEX-FIRST for the same reason services/brain_rbac.py's
classifier is: the LLM must NEVER be the last line of defence. RBAC downstream
still enforces authorization even if these guards let something through.

Design principles:
  • Prefer FALSE ACCEPTS over false rejects for relevance — a real question
    getting refused is a worse UX bug than the LLM burning a few tokens on a
    borderline one. RBAC + tenant scoping keeps false accepts safe.
  • Prefer FALSE POSITIVES over false negatives for injection — a legitimate
    question getting a "can't bypass rules" message is annoying but recoverable;
    an injection slipping through and being processed as a normal question is
    dangerous. (RBAC still enforces, so the danger is limited to token waste and
    weird LLM output.)
"""
import re
from dataclasses import dataclass
from typing import Optional


# ---------------------------------------------------------------------------
# Relevance
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class RelevanceVerdict:
    is_relevant: bool
    category: str  # "relevant" | "irrelevant" | "ambiguous"
    reason: str    # human-readable, for audit + response


# Off-topic patterns — questions that are UNAMBIGUOUSLY not about running the
# company. Ordered specific → general. Word-boundaries keep "poem" from
# matching "policy on poems" etc.
_IRRELEVANT_PATTERNS = [
    ("weather",    r"\b(weather|forecast|temperature|rain(ing)?|snow|humidity)\b"),
    ("sports",     r"\b(cricket|football|soccer|ipl|world cup|nba|nfl|match|score|goal)\b"),
    ("entertainment", r"\b(movie|film|netflix|song|lyrics|singer|actor|actress|celebrity)\b"),
    ("creative",   r"\b(poem|poetry|haiku|essay|story|novel|joke|riddle|romantic|love letter)\b"),
    ("recipe",     r"\b(recipe|biryani|pasta|cook(ing)?|ingredient)\b"),
    ("trivia",     r"\b(capital of|who (is|was) the (president|prime minister)|when (did|was)|history of)\b"),
    ("general_ai", r"\b(chatgpt|gpt-?[0-9]|openai|write me (a|an) (essay|poem|story))\b"),
]

# DecisionOS-relevant vocabulary — positive signals. If ANY of these hit, we
# treat the question as relevant even if it lacks polish.
_RELEVANT_PATTERNS = [
    # Operations / process (plurals + common ops adjectives)
    r"\b(tasks?|todo|workflows?|process(es)?|handoffs?|approvals?|approve|orders?|"
    r"dispatch|inventory|stocks?|deliver(y|ies)|shipments?|quality|defects?|"
    r"production|complaints?|resolutions?|bottlenecks?|delayed?|blocked?|urgent)\b",
    # Money & finance (plurals)
    r"\b(invoices?|payments?|expenses?|revenue|payroll|cash|receivables?|payables?|"
    r"budget|refunds?|reconcil|ledger|tds|gst|tax|billing|paid|unpaid|overdue)\b",
    # People / HR (plurals)
    r"\b(employees?|team|staff|hire|hiring|leaves?|attendance|resignations?|manager|"
    r"role|salary|appraisal|onboard)\b",
    # Sales / customers (plurals)
    r"\b(customers?|clients?|leads?|deals?|pipeline|quotes?|quotations?|"
    r"churn|renewals?|conversion)\b",
    # Vendors / procurement (plurals)
    r"\b(vendors?|suppliers?|purchase orders?|\bpos?\b|procurement|rfq)\b",
    # Documents / policy (plurals)
    r"\b(polic(y|ies)|sop|filings?|contracts?|nda|handbook|documents?|reports?)\b",
    # Personal / conversational-but-legit
    r"\b(my (task|leave|inbox|approval|work|activity|todo)|assigned to me|"
    r"what should i (focus on|do)|what.?s pending|anything (urgent|blocking))\b",
    # Decisions / meta
    r"\b(decision|decided|approved|rejected|pending|escalat|discuss|meeting|minutes)\b",
    # Company / entity words that only make sense in a company context
    r"\b(our|we|us|the team|the company|the office|our (customer|vendor|team|order|deal|policy))\b",
]

_IRRELEVANT_RX = [(name, re.compile(pat, re.I)) for name, pat in _IRRELEVANT_PATTERNS]
_RELEVANT_RX = [re.compile(pat, re.I) for pat in _RELEVANT_PATTERNS]


def relevance_result(message: str) -> RelevanceVerdict:
    """Classify a message as relevant / irrelevant / ambiguous.

    Rules (in order):
      1. If ANY relevant DecisionOS vocabulary matches → relevant.
         (Precedence: legit words override off-topic words. e.g. "recipe for
         handling customer complaints" is a real ops question, not a recipe.)
      2. Else if any irrelevant pattern matches → irrelevant.
      3. Else → ambiguous (which the caller treats as relevant — RBAC will
         still enforce authorization downstream).
    """
    msg = (message or "").strip()
    if not msg:
        return RelevanceVerdict(False, "irrelevant", "empty message")

    for rx in _RELEVANT_RX:
        if rx.search(msg):
            return RelevanceVerdict(True, "relevant", "matched DecisionOS vocabulary")

    for name, rx in _IRRELEVANT_RX:
        if rx.search(msg):
            return RelevanceVerdict(False, "irrelevant", f"matched off-topic pattern: {name}")

    return RelevanceVerdict(True, "ambiguous", "no strong signal — deferring to RBAC")


# ---------------------------------------------------------------------------
# Prompt-injection detection
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class InjectionVerdict:
    is_injection: bool
    pattern_id: Optional[str]  # None when clean
    reason: str


# These regexes cover the injection cliches from the spec + common real-world
# attempts. Kept precise so genuine questions don't false-positive.
# NB: "reveal your system prompt" is under `reveal_internals`, not `impersonation`.
_INJECTION_PATTERNS = [
    ("ignore_instructions", r"\b(ignore|disregard|override|forget)\b.*\b(previous|prior|all|earlier|system|above)\b.*\b(instruction|rule|prompt|message)s?\b"),
    ("ignore_short",        r"\bignore (all )?(previous|prior|the) (instruction|rule|prompt)s?\b"),
    ("ignore_auth_word",    r"\b(ignore|disregard|skip|bypass|override|turn off)\b.*\b(rbac|permission|access[- ]?control|auth(oriz(ation)?)?|security|guard|filter|rule)s?\b"),
    ("role_impersonation",  r"\b(pretend|act|role[- ]?play|behave)\b.*\b(?:i(?:'?m| am)|as)\b.*\b(owner|admin|administrator|superuser|root|manager|ceo|founder)\b"),
    ("impersonation_short", r"\b(i am|i'?m) (the )?(owner|admin|administrator|superuser|root|ceo|founder)\b"),
    ("disable_security",    r"\b(disable|turn off|bypass|remove|skip)\b.*\b(security|rbac|permission|authoriz|access control|rule|check|filter)s?\b"),
    ("reveal_internals",    r"\b(reveal|show|print|expose|leak|display)\b.*\b(system prompt|instructions|hidden prompt|your prompt|source code|api key|secret)\b"),
    ("elevate_privilege",   r"\b(give me|grant me|elevate|escalate)\b.*\b(admin|root|owner|higher|full|all)\b.*\b(access|permission|privilege)s?\b"),
    ("use_other_user",      r"\buse (another|other|somebody|someone)\b.*\b(user|account|permission|credential|token|session)s?\b"),
    ("bypass_rbac",         r"\b(bypass|circumvent|get around|work around|evade)\b.*\b(rbac|permission|access|auth)s?\b"),
    ("jailbreak",           r"\b(jailbreak|dan mode|developer mode|unrestricted mode|no restrictions?)\b"),
]

_INJECTION_RX = [(name, re.compile(pat, re.I)) for name, pat in _INJECTION_PATTERNS]


def injection_result(message: str) -> InjectionVerdict:
    """Detect obvious prompt-injection / role-impersonation attempts."""
    msg = (message or "").strip()
    if not msg:
        return InjectionVerdict(False, None, "empty")
    for name, rx in _INJECTION_RX:
        if rx.search(msg):
            return InjectionVerdict(True, name, f"matched injection pattern: {name}")
    return InjectionVerdict(False, None, "clean")


# ---------------------------------------------------------------------------
# Response messages — used by routers/chatbot.py so all guard refusals share
# consistent, safe wording.
# ---------------------------------------------------------------------------
IRRELEVANT_MESSAGE = (
    "I can help with your company's operations, tasks, decisions, policies, "
    "documents, and business information available through DecisionOS. "
    "Try asking about your pending tasks, workflows, or team activity."
)

INJECTION_MESSAGE = (
    "I can't bypass the application's access controls or security rules. "
    "Feel free to ask me a normal DecisionOS question — like your pending "
    "work, decisions, or team activity — and I'll answer based on your "
    "role's permissions."
)
