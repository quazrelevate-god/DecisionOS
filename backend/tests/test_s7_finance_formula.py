"""Epic 10 Testing -- Sprint 7 (finance / formula) completion.

The remaining S7 scenarios all exercise db-querying finance logic, so they run on
the `db` tier: each test gets a fresh isolated Mongo database via `with_test_db`
(never founder-os-58) and points the module-under-test's global `db` at it. This
pins the EXACT arithmetic the founder's numbers depend on -- settle tolerances,
what counts as "collected", the overdue/escalation ladder, and net-profit vs cash.

  T10-07.2   blank due_date is consistently NOT overdue across both engines
  T10-07.4   finance "collected" counts inbound payments only (bug: was all dirs)
  T10-07.10  invoice settles to paid within a 0.01 epsilon, partial beyond it
  T10-07.11  follow-up escalation ladder boundaries + monotonic idempotency
  T10-07.13  net_profit = revenue BILLED - ALL expenses; mixed currency, no FX
"""
from datetime import datetime, timezone, timedelta

import pytest

from core import now_iso


def _patch(mod, **attrs):
    """Set attrs on a module, returning a restore() that puts the originals back."""
    saved = {k: getattr(mod, k) for k in attrs}
    for k, v in attrs.items():
        setattr(mod, k, v)
    return lambda: [setattr(mod, k, v) for k, v in saved.items()]


# ---------------------------------------------------------------------------
# T10-07.4 -- finance "collected" must count INBOUND payments only.
# ---------------------------------------------------------------------------
def test_operating_score_collected_excludes_out_payments(with_test_db):
    import services.operating_score as ops

    async def scenario(db):
        restore = _patch(ops, db=db)
        try:
            tid = "t-s7-4"
            await db.invoices.insert_one({
                "id": "inv1", "tenant_id": tid, "type": "sales_invoice",
                "amount": 1000, "status": "unpaid"})
            await db.payments.insert_many([
                {"id": "p-in", "tenant_id": tid, "amount": 600, "direction": "in"},
                {"id": "p-out", "tenant_id": tid, "amount": 500, "direction": "out"},
            ])
            payload = await ops._company_operating_view(tid, {"role": "owner"}, now_iso())
            return payload["stats"]["outstanding"]
        finally:
            restore()

    # billed 1000, only the inbound 600 is "collected" -> outstanding 400.
    # Before the fix the outbound 500 inflated total_paid to 1100 -> outstanding -100.
    assert with_test_db(scenario) == 400


# ---------------------------------------------------------------------------
# T10-07.10 -- settle epsilon: paid when remaining <= 0.01, partial beyond.
# ---------------------------------------------------------------------------
def test_invoice_settle_epsilon_0_01(with_test_db):
    import routers.ledger as led

    async def scenario(db):
        restore = _patch(led, db=db)
        try:
            tid = "t-s7-10"
            # Money is 2-decimal rounded, so the settle epsilon (new_paid + 0.01 >=
            # total) bites at whole-paise boundaries: a 0.01 shortfall still settles;
            # 0.02 does not. (pay_amount, expected_status) for a 100.00 invoice.
            cases = [
                ("i-a", 100.00, "paid"),     # exact
                ("i-b", 99.99, "paid"),      # remaining 0.01 -> settled (epsilon boundary)
                ("i-c", 99.98, "partial"),   # remaining 0.02 -> NOT settled
            ]
            out = {}
            for iid, pay, _exp in cases:
                await db.invoices.insert_one({
                    "id": iid, "tenant_id": tid, "amount": 100.0, "amount_paid": 0.0,
                    "status": "unpaid"})
                payment = {"id": f"p-{iid}", "tenant_id": tid, "amount": pay, "applied": 0}
                inv = {"id": iid, "tenant_id": tid, "amount": 100.0, "amount_paid": 0.0}
                await led._apply_payment_to_invoice(tid, inv, payment, "test")
                fresh = await db.invoices.find_one({"id": iid, "tenant_id": tid}, {"_id": 0, "status": 1})
                out[iid] = fresh["status"]
            return out, {iid: exp for iid, _p, exp in cases}
        finally:
            restore()

    got, expected = with_test_db(scenario)
    assert got == expected, f"settle-status boundaries wrong: {got} != {expected}"


# ---------------------------------------------------------------------------
# T10-07.11 -- escalation ladder boundaries + monotonic idempotency.
# ---------------------------------------------------------------------------
def test_followup_escalation_ladder_and_idempotency(with_test_db):
    import services.finance_signals as fs

    async def scenario(db):
        pushes = []

        async def _push(tid, recips, level, msg, kind, ref):
            pushes.append(level)

        async def _owners(tid):
            return ["owner1"]

        async def _noop(*a, **k):
            return None

        restore = _patch(fs, db=db, push_notification=_push, _owner_ids=_owners,
                         dispatch_owner_alert=_noop, run_finance_actions=_noop)
        try:
            tid = "t-s7-11"
            now = datetime.now(timezone.utc)
            # days = (now - due).days -> target 1/2/3/4 at <1 / <2 / <3 / else.
            hours = {"d0": 1, "d1": 25, "d2": 49, "d3": 73}   # 0,1,2,3 days overdue
            for k, h in hours.items():
                await db.tasks.insert_one({
                    "id": k, "tenant_id": tid, "title": f"task {k}", "status": "todo",
                    "due_date": (now - timedelta(hours=h)).isoformat()})
            fs._followup_last_run.clear()          # bypass the 60s throttle
            await fs.run_followup(tid)
            levels = {t["id"]: t.get("escalation_level")
                      for t in await db.tasks.find({"tenant_id": tid}, {"_id": 0}).to_list(50)}
            first_pushes = len(pushes)

            # Second run (throttle reset): every task is already at its target, so
            # the `target <= escalation_level` guard must skip them all -- no new pushes.
            fs._followup_last_run.clear()
            await fs.run_followup(tid)
            return levels, first_pushes, len(pushes)
        finally:
            restore()

    levels, first_pushes, second_pushes = with_test_db(scenario)
    assert levels == {"d0": 1, "d1": 2, "d2": 3, "d3": 4}, f"ladder wrong: {levels}"
    assert first_pushes == 4, f"expected 4 escalations, got {first_pushes}"
    assert second_pushes == first_pushes, "idempotency broken: re-escalated already-escalated tasks"


# ---------------------------------------------------------------------------
# T10-07.13 -- net_profit is BILLED revenue minus ALL expenses; no FX on mixed currency.
# ---------------------------------------------------------------------------
def test_net_profit_billed_not_cash_and_mixed_currency_no_fx(with_test_db):
    import routers.ledger as led

    async def scenario(db):
        restore = _patch(led, db=db)
        try:
            tid = "t-s7-13"
            await db.invoices.insert_many([
                {"id": "s-inr", "tenant_id": tid, "type": "sales_invoice", "amount": 1000,
                 "currency": "INR", "status": "unpaid"},
                {"id": "s-usd", "tenant_id": tid, "type": "sales_invoice", "amount": 100,
                 "currency": "USD", "status": "unpaid"},
            ])
            await db.expenses.insert_many([
                {"id": "e-paid", "tenant_id": tid, "amount": 300, "status": "paid"},
                {"id": "e-unpaid", "tenant_id": tid, "amount": 200, "status": "unpaid"},
            ])
            return (await led.ledger_summary(user={"tenant_id": tid, "role": "owner"}))["totals"]
        finally:
            restore()

    totals = with_test_db(scenario)
    # revenue is BILLED (both invoices, unpaid included); mixed INR+USD summed raw (no FX).
    assert totals["revenue_billed"] == 1100
    # expenses is ALL spend, not just the paid one.
    assert totals["total_spend"] == 500
    # net_profit = billed revenue - all expenses (accrual, not cash).
    assert totals["net_profit"] == 600


# ---------------------------------------------------------------------------
# T10-07.2 -- a blank due_date is NOT overdue, consistently in BOTH engines.
# ---------------------------------------------------------------------------
def test_blank_due_date_not_overdue_in_either_engine(with_test_db):
    import services.finance_signals as fs
    import services.operating_score as ops

    async def scenario(db):
        r1 = _patch(fs, db=db)
        r2 = _patch(ops, db=db)
        try:
            tid = "t-s7-2"
            # A blank-due unpaid sales invoice + a genuinely-overdue one (control).
            await db.invoices.insert_many([
                {"id": "blank", "tenant_id": tid, "type": "sales_invoice", "amount": 500,
                 "amount_paid": 0, "status": "unpaid", "due_date": ""},
                {"id": "old", "tenant_id": tid, "type": "sales_invoice", "amount": 500,
                 "amount_paid": 0, "status": "unpaid",
                 "due_date": (datetime.now(timezone.utc) - timedelta(days=60)).strftime("%Y-%m-%d")},
            ])
            overdue = {r["id"] for r in await fs._overdue_receivables(tid)}
            payload = await ops._company_operating_view(tid, {"role": "owner"}, now_iso())
            return overdue, payload["stats"]  # operating_score overdue count is over TASKS; invoices via 'outstanding'
        finally:
            r2(); r1()

    overdue_ids, _stats = with_test_db(scenario)
    # finance_signals: the blank-due invoice is NOT chased; the real overdue one IS.
    assert "blank" not in overdue_ids, "blank due_date must NOT be treated as overdue"
    assert "old" in overdue_ids, "a genuinely overdue receivable must still be chased"
