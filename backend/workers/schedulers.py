"""Background scheduler loops (Epic 8 Sprint 7 -- U8-07.1).

Extracted verbatim from server.py. The follow-up sweep runs escalation/finance
actions for every tenant on a timer so overdue alerts fire even when nobody is
polling /notifications; a Mongo leader-lock keeps it single-flight across
replicas. Provider-outage alerts piggyback on the same tick.

The lifespan wiring (bootstrap/lifecycle.py) imports these directly; server.py
also re-exports them for backward compatibility.
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone

from core import db, logger, now_iso
from services.email import send_email

# Epic 9 S9: run the DPDP retention purge at most once per ~24h (leader-only).
RETENTION_SWEEP_MIN_INTERVAL_SECONDS = 20 * 3600

# _followup_last_run is the per-tenant poll-throttle map owned by finance_signals.
# The timer sweep clears a tenant's entry so it bypasses the 60s poll throttle.
# (Historically referenced bare in server.py without an import -- a latent
# NameError on the sweep path; importing it here fixes that.)
from services.finance_signals import run_followup, _followup_last_run

FOLLOWUP_INTERVAL_SECONDS = int(os.environ.get("FOLLOWUP_INTERVAL_SECONDS", "300") or "300")


async def _followup_scheduler_loop():
    # FIX-002-D: distributed leader lock. Every replica keeps ticking on
    # its own timer, but only the replica that acquires the Mongo lock
    # runs the sweep for a given tick. Prevents 3x duplicate escalation
    # emails / platform alerts under multi-replica deploys (and the
    # sweep still fires with only 1 replica — natural single-tenancy of
    # the lock). Lease of 2x the tick interval gives a comfortable
    # margin over normal sweep duration (~seconds); a crashed leader's
    # lock naturally expires on the next tick's attempt.
    from services.leader_lock import try_acquire, release, make_holder_id

    holder_id = make_holder_id("followup-scheduler")
    lease_seconds = max(FOLLOWUP_INTERVAL_SECONDS * 2, 120)
    # Small initial delay so startup/bootstrap finishes first.
    await asyncio.sleep(30)
    while True:
        got_lock = False
        try:
            # Epic 10 S6: refresh runtime platform config on every replica each tick
            # so an admin model/Sarvam/flag change converges across the fleet (<=1 tick).
            try:
                from services.platform_config import refresh as _refresh_platform_config
                await _refresh_platform_config()
            except Exception as e:
                logger.debug(f"[scheduler] platform_config refresh failed: {e}")
            got_lock = await try_acquire(db, "followup_sweep", holder_id, lease_seconds=lease_seconds)
            if not got_lock:
                logger.debug("[followup-scheduler] another replica is leader this tick; skipping")
                await asyncio.sleep(FOLLOWUP_INTERVAL_SECONDS)
                continue
            try:
                tenant_ids = await db.tenants.distinct("id")
                for tid in tenant_ids:
                    try:
                        # Bypass the per-tenant 60s poll throttle for the timer sweep.
                        _followup_last_run.pop(tid, None)
                        await run_followup(tid)
                    except Exception as e:
                        logger.warning(f"[followup-scheduler] tenant {tid} failed: {e}")
                logger.info(
                    f"[followup-scheduler] leader swept {len(tenant_ids)} tenant(s); next in {FOLLOWUP_INTERVAL_SECONDS}s"
                )
            except Exception as e:
                logger.warning(f"[followup-scheduler] sweep failed: {e}")
            try:
                await _notify_provider_outages()
            except Exception as e:
                logger.warning(f"[followup-scheduler] outage-alert check failed: {e}")
            try:
                await _maybe_run_retention_sweep()
            except Exception as e:
                logger.warning(f"[followup-scheduler] retention sweep failed: {e}")
        except Exception as e:
            # Never let a lock or DB error stop the loop — next tick retries.
            logger.exception(f"[followup-scheduler] tick error: {e}")
        finally:
            if got_lock:
                # Clean release so a redeploy hands the lock over immediately
                # instead of waiting for lease expiry.
                try:
                    await release(db, "followup_sweep", holder_id)
                except Exception:
                    pass  # natural TTL expiry handles it
        await asyncio.sleep(FOLLOWUP_INTERVAL_SECONDS)


async def _maybe_run_retention_sweep():
    """Run the DPDP retention purge at most once per ~24h. Only the scheduler
    leader reaches this (it's inside the leader-locked block), and a
    db.platform_ops marker throttles it across restarts so a redeploy storm
    can't re-run it every few minutes."""
    from services.retention import run_retention_sweep

    now = datetime.now(timezone.utc)
    marker = await db.platform_ops.find_one({"id": "retention_sweep"})
    if marker and marker.get("last_run"):
        try:
            last = datetime.fromisoformat(marker["last_run"])
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            if (now - last).total_seconds() < RETENTION_SWEEP_MIN_INTERVAL_SECONDS:
                return
        except ValueError:
            pass  # unparseable marker -> run and overwrite it
    result = await run_retention_sweep(dry_run=False)
    await db.platform_ops.update_one(
        {"id": "retention_sweep"},
        {"$set": {
            "last_run": now.isoformat(),
            "last_result": {
                "tenants_with_policy": result["tenants_with_policy"],
                "total_purged": result["total_purged"],
            },
        }},
        upsert=True,
    )
    if result["total_purged"]:
        logger.info(
            f"[retention] purged {result['total_purged']} row(s) across "
            f"{result['tenants_with_policy']} tenant(s)"
        )


async def _notify_provider_outages():
    """Email the platform super-admin once per new AI-provider outage alert."""
    pending = await db.platform_alerts.find({"resolved": False, "notified": False}, {"_id": 0}).to_list(20)
    if not pending:
        return
    admin_email = os.environ.get("SUPERADMIN_EMAIL", "admin@decisionos.biz").strip()
    for a in pending:
        subject = f"[DecisionOS] AI provider alert: {a['provider']} — {a.get('status')}"
        html = (
            f"<h3>AI provider outage detected</h3>"
            f"<p><b>Provider:</b> {a['provider']}<br/>"
            f"<b>Status:</b> {a.get('status')}<br/>"
            f"<b>Detail:</b> {a.get('message','')}</p>"
            f"<p>Open the Admin Console → AI Keys to update the key or clear it so AI falls back to the Emergent universal key.</p>"
        )
        res = await send_email(admin_email, subject, html)
        await db.platform_alerts.update_one(
            {"id": a["id"]},
            {
                "$set": {
                    "notified": True,
                    "notified_at": now_iso(),
                    "notify_result": res.get("provider") or ("sent" if res.get("sent") else "mock"),
                }
            },
        )
        logger.info(f"[outage-alert] notified admin about {a['provider']} ({a.get('status')})")
