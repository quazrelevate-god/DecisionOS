"""Which workspaces are customers and which are ours (admin console, 2026-10-22).

The platform admin console listed test companies (TEST_Co_b4923a, QA Owner's
workspace, the demo) beside paying customers in every list and every total, so
"how many companies use us" and "what did AI cost us this week" were both
inflated by our own testing — and production holds 105 workspaces. The console
now hides test workspaces by default; this module decides which ones they are.

The rule, in order:
  1. an explicit mark an admin set ("Mark as test" / "Mark as customer") wins;
  2. the demo workspace bootstrap seeds is a test workspace;
  3. a name that says so: starts with "TEST" or contains the word test,
     testing, qa, demo, e2e, sandbox or dummy.

Anything else is a customer. A wrong guess is one click to correct, and the
mark sticks.
"""
import re

_TEST_NAME = re.compile(r"^test[\s_\-]|\b(test|testing|qa|demo|e2e|sandbox|dummy)\b", re.I)
_TEST_EMAIL = re.compile(r"@example\.(com|org|net)$", re.I)


def workspace_name(t: dict) -> str:
    return (t or {}).get("company_name") or (t or {}).get("name") or "—"


def is_test_tenant(t: dict) -> bool:
    t = t or {}
    if isinstance(t.get("is_test"), bool):
        return t["is_test"]
    if t.get("is_demo") or t.get("demo"):
        return True
    return bool(_TEST_NAME.search(workspace_name(t)))


def test_reason(t: dict) -> str:
    """Why a workspace counts as test — shown beside the mark in the console."""
    t = t or {}
    if isinstance(t.get("is_test"), bool):
        return "Marked by an admin"
    if t.get("is_demo") or t.get("demo"):
        return "Demo workspace"
    if _TEST_NAME.search(workspace_name(t)):
        return "Name looks like a test"
    return ""


def is_test_email(email: str) -> bool:
    return bool(_TEST_EMAIL.search(email or ""))
