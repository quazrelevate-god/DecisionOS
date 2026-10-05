"""Calculated, not AI (2026-10-06, AI audit step 5 — founder: "we don't need AI
… we have to use a calculated approach").

Each of these used to be a Claude call over numbers or fixed lists the app
already had: an expense category out of the company's own list, a 0-100 score
for a customer or a task, a paragraph about someone's work stats, who should
cover a person's tasks on leave. (Expense / asset / stock for an old bill was
one too; it went with the re-sync that used it, 2026-10-06.) A rule does each of them the same way every time, explains itself, costs
nothing, answers instantly, and never sends company data out.

The finance rules LEARN FROM THE COMPANY: its own past bills (the same vendor is
usually booked the same way), the words it has used before, and the names of its
own categories — then the built-in keyword table — and they say which of those
decided it. When nothing applies, they say so instead of guessing.
"""
from __future__ import annotations

import re
from collections import Counter
from datetime import datetime, timezone
from typing import Optional

from core import db

_STOP = {"the", "and", "for", "from", "with", "bill", "invoice", "payment", "paid", "amount", "to", "of",
         "inr", "rs", "no", "nos", "qty", "pvt", "ltd", "limited", "private", "co", "company", "and"}


def _words(text) -> set:
    out = set()
    for w in re.split(r"[^a-z0-9]+", str(text or "").lower()):
        if len(w) < 3 or w in _STOP or w.isdigit():
            continue
        out.add(w[:-1] if len(w) > 4 and w.endswith("s") else w)
    return out


def _kw_hit(words: set, text: str, kw: str) -> bool:
    """A keyword hits on WHOLE words: "car" must not fire on "cartons", nor "rent"
    on "current" (the built-in tables were written for substring matching). A
    phrase must appear as a phrase; a long single keyword may be a word's stem
    ("advertis" -> "advertising")."""
    kw = kw.lower().strip()
    if " " in kw:
        return re.search(r"\b" + re.escape(kw) + r"\b", text) is not None
    return kw in words or (len(kw) >= 5 and any(w.startswith(kw) for w in words))


def _guess(table: list, text: str) -> str:
    t = str(text or "").lower()
    ws = set(re.split(r"[^a-z0-9]+", t)) | _words(t)
    for cat, kws in table:
        if any(_kw_hit(ws, t, k) for k in kws):
            return cat
    return "Other"


# --- expense categories --------------------------------------------------------
def _company_keywords(categories: list) -> dict:
    """Each of the company's own category names -> the words that point to it:
    its name, plus the built-in keywords of any default category that shares a
    word with it ("Yarn & Fibre" inherits Raw Material's yarn/cotton/thread…)."""
    from services.finance_words import _CATEGORY_KEYWORDS
    out = {}
    for cat in categories:
        own = _words(cat)
        words = set(own)
        for default_name, kws in _CATEGORY_KEYWORDS:
            dn = _words(default_name)
            kw_words = set().union(*(_words(k) for k in kws)) if kws else set()
            if own & (dn | kw_words) or default_name.lower() == str(cat).lower():
                words |= dn | kw_words
        out[cat] = words
    return out


async def suggest_expense_category(tenant_id: str, text: str, vendor: Optional[str] = None,
                                   categories: Optional[list] = None) -> dict:
    """{category, reason, how}. how: vendor | history | name | keyword | none."""
    from services.finance_words import get_finance_categories, _CATEGORY_KEYWORDS, _match_category
    cats = categories or (await get_finance_categories(tenant_id))["expense"]
    other = _match_category("Other", cats, cats[-1] if cats else "Other")
    vendor = (vendor or "").strip()
    past = await db.expenses.find(
        {"tenant_id": tenant_id, "category": {"$in": [c for c in cats if c != "Other"]}},
        {"_id": 0, "category": 1, "vendor_name": 1, "title": 1}).sort("created_at", -1).to_list(2000)
    # 1) the same vendor has been booked this way before
    if vendor:
        same = Counter(e["category"] for e in past if str(e.get("vendor_name") or "").strip().lower() == vendor.lower())
        if same:
            cat, n = same.most_common(1)[0]
            return {"category": cat, "how": "vendor",
                    "reason": f"Your earlier {'bill' if n == 1 else f'{n} bills'} from {vendor} went to {cat}."}
    words = _words(f"{text} {vendor}")
    if not words:
        return {"category": other, "how": "none", "reason": "Nothing to go on — choose a category."}
    # 2) words the company has used before
    votes: Counter = Counter()
    for e in past:
        overlap = words & _words(e.get("title"))
        if overlap:
            votes[e["category"]] += len(overlap)
    if votes:
        cat, score = votes.most_common(1)[0]
        if score >= 2:
            return {"category": cat, "how": "history", "reason": f"Like your earlier expenses booked to {cat}."}
    # 3) the company's own category names (and the words they inherit)
    best, best_n = None, 0
    for cat, kw in _company_keywords(cats).items():
        n = len(words & kw)
        if n > best_n:
            best, best_n = cat, n
    if best and best != "Other":
        return {"category": best, "how": "name", "reason": f"The words match your {best} category."}
    # 4) the built-in keyword table, snapped onto the company's list
    guess = _match_category(_guess(_CATEGORY_KEYWORDS, f"{text} {vendor}"), cats, "")
    if guess and guess != "Other":
        return {"category": guess, "how": "keyword", "reason": f"Usually {guess}."}
    return {"category": other, "how": "none", "reason": "No rule matched — choose a category."}


# --- scores ----------------------------------------------------------------------
def _clamp(v) -> int:
    return max(0, min(100, int(round(v))))


def _days_since(iso) -> Optional[int]:
    try:
        d = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return max(0, (datetime.now(timezone.utc) - d).days)
    except Exception:
        return None


def score_contact(contact: dict, metrics: dict, currency: str = "INR") -> dict:
    """Relationship 0-100 (higher = healthier) and risk 0-100 (higher = worry),
    from what the books and complaints say. Same fields the AI returned."""
    from shared.money import money_words
    billed = float(metrics.get("total_billed") or 0)
    paid = float(metrics.get("total_paid") or 0)
    outstanding = max(0.0, float(metrics.get("outstanding") or 0))
    complaints = int(metrics.get("open_complaints") or 0)
    deliveries = int(metrics.get("pending_deliveries") or 0)
    invoices = int(metrics.get("invoice_count") or 0)
    since = _days_since(metrics.get("last_payment")) if metrics.get("last_payment") else None
    supplier = (contact.get("type") or "") == "vendor"
    signals = []
    rel, risk = 55.0, 20.0
    if billed > 0:
        ratio = min(1.0, paid / billed)
        rel += 30 * ratio - 15
        risk += 45 * (outstanding / billed)
        signals.append(f"{'We have paid' if supplier else 'Paid'} {round(ratio * 100)}% of {money_words(billed, currency)} billed")
    if since is not None:
        if since <= 30:
            rel += 10
            signals.append(f"Last payment {since} day{'s' if since != 1 else ''} ago")
        elif since > 90:
            rel -= 10
            risk += 15
            signals.append(f"No payment for {since} days")
        elif since > 60:
            risk += 10
    elif billed > 0:
        rel -= 10
        risk += 10
        signals.append("No payment recorded yet")
    if invoices >= 10:
        rel += 10
    elif invoices >= 5:
        rel += 5
    if complaints:   # a complaint is news: it leads the reason (after money owed)
        rel -= min(24, 8 * complaints)
        risk += min(30, 10 * complaints)
        signals.insert(0, f"{complaints} open complaint{'s' if complaints != 1 else ''}")
    if deliveries:
        signals.append(f"{deliveries} order{'s' if deliveries != 1 else ''} in progress")
    if outstanding and not supplier:
        signals.insert(0, f"{money_words(outstanding, currency)} outstanding")
    elif outstanding and supplier:
        signals.insert(0, f"We owe {money_words(outstanding, currency)}")
    reason = "; ".join(signals[:3]) if signals else "Not enough history yet to judge this relationship."
    return {"relationship_score": _clamp(rel), "risk_score": _clamp(risk), "reason": reason[:200],
            "signals": [s[:60] for s in signals[:3]], "method": "calculated"}


_PRIORITY_W = {"urgent": 95, "critical": 95, "high": 85, "medium": 55, "normal": 55, "low": 25}
_MONEY_WORDS = re.compile(r"\b(invoice|payment|order|dispatch|shipment|customer|buyer|advance|proforma|quote|sale)\b", re.I)


def score_tasks(tasks: list) -> dict:
    """{task_id: {business_impact, revenue, risk, urgency, priority_score, reason, method}}
    from the due date, priority, status and what the task is tied to."""
    today = datetime.now(timezone.utc).date()
    out = {}
    for t in tasks:
        why = []
        due = (t.get("due_date") or "")[:10]
        try:
            days = (datetime.fromisoformat(due).date() - today).days if due else None
        except ValueError:
            days = None
        if days is None:
            urgency = 20
        elif days < 0:
            urgency = min(100, 85 + 3 * (-days))
            why.append(f"overdue by {-days} day{'s' if days != -1 else ''}")
        elif days == 0:
            urgency = 90
            why.append("due today")
        elif days <= 2:
            urgency = 75
            why.append(f"due in {days} day{'s' if days != 1 else ''}")
        elif days <= 7:
            urgency = 50
        else:
            urgency = 25
        pw = _PRIORITY_W.get(str(t.get("priority") or "medium").lower(), 55)
        if pw >= 85:
            why.append(f"{t.get('priority')} priority")
        status = t.get("status") or ""
        risk = 70 if status in ("blocked", "waiting") else 40 if status == "review" else 30
        if status in ("blocked", "waiting"):
            why.append(status)
        impact = pw
        if t.get("workflow_id"):
            impact += 15
            why.append("moves a pipeline card")
        if t.get("decision_id"):
            impact += 10
        text = f"{t.get('title') or ''} {t.get('description') or ''}"
        revenue = 70 if t.get("workflow_id") and _MONEY_WORDS.search(text) else 60 if _MONEY_WORDS.search(text) else 30
        score = 0.4 * urgency + 0.3 * pw + 0.2 * min(100, impact) + 0.1 * risk
        out[t["id"]] = {"business_impact": _clamp(impact), "revenue": _clamp(revenue), "risk": _clamp(risk),
                        "urgency": _clamp(urgency), "priority_score": _clamp(score),
                        "reason": (", ".join(why) or "no date pressure").capitalize()[:200], "method": "calculated"}
    return out


# --- coaching ----------------------------------------------------------------------
def work_coach(target: dict, stats: dict) -> dict:
    """The work review from the person's own numbers, in plain words."""
    name = ((target.get("name") or "").split() or ["this person"])[0]
    rate = stats.get("completion_rate") or 0
    overdue = stats.get("overdue") or 0
    open_n = stats.get("open") or 0
    proof = stats.get("proof_upload_rate") or 0
    timing = stats.get("timing") or {}
    on_time = timing.get("on_time_rate")
    strengths, improvements = [], []
    if stats.get("completed"):
        strengths.append(f"Finished {stats['completed']} task{'s' if stats['completed'] != 1 else ''} ({rate}% of assigned work)")
    if on_time is not None and on_time >= 80:
        strengths.append(f"{on_time}% of dated work landed on time")
    if proof >= 60:
        strengths.append(f"Backs finished work with proof ({proof}%)")
    if stats.get("plans_completed"):
        strengths.append(f"Completed {stats['plans_completed']} step-by-step plan{'s' if stats['plans_completed'] != 1 else ''}")
    if stats.get("voice_updates") or stats.get("photos_uploaded"):
        strengths.append("Keeps work updated with photos/voice notes")
    if overdue:
        improvements.append(f"{overdue} task{'s are' if overdue != 1 else ' is'} overdue — clear or re-date them")
    if on_time is not None and on_time < 60:
        improvements.append(f"Only {on_time}% of dated work was on time")
    if stats.get("completed") and proof < 40:
        improvements.append("Attach proof when closing work")
    if rate and rate < 50:
        improvements.append(f"Less than half of assigned work is finished ({rate}%)")
    if overdue:
        headline = f"{name} has {overdue} overdue of {open_n} open — the first thing to fix."
        rec = "Start with the oldest overdue task; ask for help or a new date if it is blocked."
    elif rate >= 80:
        headline = f"{name} finishes {rate}% of assigned work and nothing is overdue."
        rec = "Keep the pace; take on the next stretch task."
    elif stats.get("actionable"):
        headline = f"{name} has finished {rate}% of assigned work so far."
        rec = "Pick the next due task each morning and close it before starting another."
    else:
        headline = f"Not enough work assigned to {name} yet to review."
        rec = "Assign a few tasks with due dates to start tracking."
    return {"headline": headline[:200], "strengths": strengths[:4], "improvements": improvements[:3],
            "recommendation": rec[:240], "method": "calculated"}


def _day_after(ymd: str) -> str:
    from datetime import date, timedelta
    try:
        return (date.fromisoformat(ymd[:10]) + timedelta(days=1)).isoformat()
    except ValueError:
        return ymd


def leave_impact(person_name: str, from_date: str, to_date: str, tasks: list, members: list,
                 person_role: Optional[str] = None) -> dict:
    """For each task at risk during the leave: hand it to the least-loaded teammate
    in the same team (the task's role, else the role of the person on leave), else
    move its date to the day after the leave, else watch it."""
    if not tasks:
        return {"summary": "No active tasks are affected by this leave.", "suggestions": []}
    load = {m["id"]: m.get("load", 0) for m in members}
    back = _day_after(to_date)
    suggestions = []
    for t in tasks:
        team = t.get("assignee_role") or person_role
        same_team = [m for m in members if team and m.get("role") == team]
        due = (t.get("due_date") or "")[:10]
        if same_team and (str(t.get("priority") or "").lower() in ("high", "urgent") or (due and due <= to_date)):
            m = min(same_team, key=lambda x: load.get(x["id"], 0))
            load[m["id"]] = load.get(m["id"], 0) + 1
            suggestions.append({"task_id": t["id"], "action": "reassign", "assignee_id": m["id"], "assignee_name": m["name"],
                                "reason": f"{m['name']} is in the same team with the lightest load ({load[m['id']] - 1} open)."})
        elif due and due <= to_date:
            suggestions.append({"task_id": t["id"], "action": "extend", "due_date": back,
                                "reason": "Due during the leave and nobody in the team can take it."})
        else:
            suggestions.append({"task_id": t["id"], "action": "monitor", "reason": "Not due during the leave."})
    n_re = sum(1 for s in suggestions if s["action"] == "reassign")
    n_ex = sum(1 for s in suggestions if s["action"] == "extend")
    summary = (f"{len(tasks)} of {person_name}'s tasks are at risk from {from_date} to {to_date}: "
               f"{n_re} can be handed over, {n_ex} need a new date.")
    return {"summary": summary, "suggestions": suggestions}
