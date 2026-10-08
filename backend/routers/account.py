"""Deleting your own account.

2026-09-29. Google Play's User Data policy requires that an app which lets
people create an account also lets them delete it — from inside the app, and
from a public web URL that needs no install. Neither existed: erasure was
admin-only (routers/admin.admin_delete_tenant, routers/team.erase_member), so
the only way out was to ask somebody with more power than you. That is a
blocker for the Play listing and, separately, the wrong answer.

WHAT AN ACCOUNT IS HERE. A person is a mobile number. `users` holds one doc
per workspace they belong to (FIX-004-B left tenant_id on it for compat) and
`memberships` holds the relationship. So "delete my account" is not one row —
it is every workspace this number can sign into, which is why this asks
find_tenant_choices_for_phone rather than looking at the current session only.

THREE OUTCOMES, decided per workspace:

  you_leave          You are not the owner. Your membership and your user row
                     go, and your NUMBER IS FREED. What your work left behind
                     — tasks, decisions, contacts, the audit log — stays. That
                     is deliberate and it matches routers/team.erase_member:
                     a company that loses its history because somebody left is
                     worse off than one carrying a row saying they were here.

  workspace_deleted  You own it and nobody else is in it. Deleting you would
                     otherwise strand a workspace with no one who can reach
                     it, so the whole thing goes — every collection and every
                     uploaded file (services/tenant_wipe).

  blocked            You own it and other people are in it. Deleting you
                     silently would either destroy a company that other people
                     depend on, or leave it with no owner. Neither is ours to
                     choose, so we ask: the owner can name the workspace in
                     `delete_workspaces` to delete it with everyone in it, or
                     remove people first. (2026-10-08, Play audit C3: a refusal
                     with no way through is the "obstacle" the Account Deletion
                     policy forbids, and there is no ownership hand-over yet.)

A blocker stops the WHOLE request, not just that workspace. Half-deleting
somebody and reporting partial success is worse than not starting: they think
they are gone, and they are not.

WHAT ELSE GOES WITH THE PERSON (2026-10-08, Play audit C3). The user row was
never the whole of somebody: their push tokens, sessions (IP, user agent),
notifications, one-time codes, sign-in lockout counters, unfinished signup
drafts and email tokens were all left behind, and the audit log kept their IP
and email against every action. _erase_personal_traces takes those. Work they
did for a company stays with the company (above); payment records stay for as
long as tax law requires, which the privacy policy says.
"""
import re
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from core import db, logger, now_iso, get_current_user, clear_auth_cookie

router = APIRouter(prefix="/api/account")

# Typed by the person, exactly, before anything is erased. Not a checkbox: the
# whole point is a deliberate act that a mis-tap cannot produce.
CONFIRM_PHRASE = "DELETE"


class DeleteAccountInput(BaseModel):
    confirm: str
    # Workspaces the owner has explicitly chosen to delete along with everyone
    # in them. Only meaningful for an outcome that would otherwise be blocked.
    delete_workspaces: List[str] = []


async def _plan(user: dict) -> dict:
    """What deleting this person would do, workspace by workspace.

    Pure read. The same function answers the preview and drives the delete,
    so what somebody is shown is what actually happens.
    """
    from services.auth.membership import list_memberships_for_tenant, SEAT_STATUSES
    from services.auth.phone import find_tenant_choices_for_phone

    norm = (user.get("phone_norm") or "").strip()
    if norm:
        choices = await find_tenant_choices_for_phone(db, norm)
    else:
        # Legacy account with no mobile on it: the session's own workspace is
        # all we can honestly claim to know about.
        t = await db.tenants.find_one({"id": user.get("tenant_id")}, {"_id": 0, "name": 1})
        choices = [{
            "tenant_id": user.get("tenant_id"), "tenant_name": (t or {}).get("name") or "",
            "user_id": user.get("id"), "role": user.get("role"),
        }]

    workspaces = []
    for c in choices:
        tenant_id = c.get("tenant_id")
        if not tenant_id:
            continue
        # WHO ELSE IS IN HERE — asked of BOTH tables, and this is not belt and
        # braces. Memberships arrived in FIX-004-B; people who predate it, and
        # anything seeded straight into `users` (the demo workspace, for one),
        # have a user row carrying tenant_id and NO membership row. Counting
        # memberships alone reported such a workspace as empty, which made its
        # owner a "sole owner" and offered to delete the whole company. Found
        # by running this against the demo workspace, which has four people in
        # it and answered `other_people: 0`.
        #
        # The union errs towards BLOCKING, which is the only safe direction: a
        # stale row costs somebody an explanation, a missed person costs them
        # their company.
        seats = await list_memberships_for_tenant(db, tenant_id, statuses=SEAT_STATUSES)
        people = {m.get("user_id") for m in seats if m.get("user_id")}
        legacy = await db.users.find(
            {"tenant_id": tenant_id}, {"_id": 0, "id": 1},
        ).to_list(500)
        people |= {u.get("id") for u in legacy if u.get("id")}
        others = people - {c.get("user_id")}
        is_owner = (c.get("role") or "") == "owner"
        entry = {
            "tenant_id": tenant_id,
            "tenant_name": c.get("tenant_name") or "",
            "role": c.get("role"),
            "user_id": c.get("user_id"),
            "other_people": len(others),
        }
        if is_owner and others:
            entry["outcome"] = "blocked"
            entry["can_delete_workspace"] = True
            entry["reason"] = (
                f"You own this workspace and {len(others)} other "
                f"{'person is' if len(others) == 1 else 'people are'} in it. "
                "We won't leave it without an owner, so choose: delete the whole "
                "workspace — everyone in it loses access and every record goes — "
                "or remove them from Team first."
            )
        elif is_owner:
            entry["outcome"] = "workspace_deleted"
        else:
            entry["outcome"] = "you_leave"
        workspaces.append(entry)

    return {
        "workspaces": workspaces,
        "blocked": [w for w in workspaces if w["outcome"] == "blocked"],
        "confirm_phrase": CONFIRM_PHRASE,
    }


async def _erase_personal_traces(*, user_ids, phone_norm: str, emails) -> None:
    """Everything about this person that is not a user row or company work.

    Runs after the workspaces are dealt with, so it also catches rows a wiped
    workspace already took (deleting nothing twice is fine). Each step is
    independent and best effort: one collection failing must not leave the
    rest in place — the account itself is already gone by now.
    """
    steps = []
    for uid in user_ids:
        steps += [
            # A push token is the person's device; the client cannot remove it
            # itself because its session was revoked a moment ago.
            ("device_tokens", "delete_many", {"user_id": uid}),
            ("active_sessions", "delete_many", {"user_id": uid}),
            ("notifications", "delete_many", {"user_id": uid}),
            ("auth_email_tokens", "delete_many", {"user_id": uid}),
            # The action stays in the company's audit trail; who-from does not.
            ("audit_log", "update_many", ({"actor_id": uid},
                {"$set": {"actor_email": None, "actor_ip": None, "actor_ua": None}})),
        ]
    if phone_norm:
        steps.append(("otp_codes", "delete_many", {"phone": phone_norm}))
    for email in emails:
        steps += [
            ("onboarding_drafts", "delete_many", {"email": email}),
            ("auth_email_tokens", "delete_many", {"email": email}),
            # Lockout counters are keyed "<ip>:<email>" (routers/auth._login_ident).
            ("user_login_attempts", "delete_many",
             {"identifier": {"$regex": f":{re.escape(email)}$"}}),
        ]
    for coll, op, arg in steps:
        try:
            if op == "update_many":
                await db[coll].update_many(*arg)
            else:
                await getattr(db[coll], op)(arg)
        except Exception as e:
            logger.warning("account_delete: %s.%s failed: %s", coll, op, e)


class TermsInput(BaseModel):
    version: str


@router.post("/terms")
async def accept_terms(inp: TermsInput, user: dict = Depends(get_current_user)):
    """Record that this person accepted the Terms of Service (Play audit C2).

    A person is a mobile number with a user row per workspace, so the
    acceptance goes on every row for that number: agreeing once is agreeing.
    The version must be the current one — accepting a document nobody is
    being shown any more means nothing.
    """
    from services.legal import TERMS_VERSION
    if (inp.version or "").strip() != TERMS_VERSION:
        raise HTTPException(status_code=409, detail={
            "message": "The terms have changed. Reload to read the current version.",
            "current_version": TERMS_VERSION,
        })
    record = {"version": TERMS_VERSION, "accepted_at": now_iso()}
    norm = (user.get("phone_norm") or "").strip()
    if norm:
        await db.users.update_many({"phone_norm": norm}, {"$set": {"terms_accepted": record}})
    await db.users.update_one({"id": user["id"]}, {"$set": {"terms_accepted": record}})
    return {"ok": True, "terms_accepted": record}


@router.get("/deletion")
async def deletion_preview(user: dict = Depends(get_current_user)):
    """What would happen, before anybody types anything."""
    return await _plan(user)


@router.delete("")
@router.post("/delete")
async def delete_account(inp: DeleteAccountInput, request: Request, response: Response,
                         user: dict = Depends(get_current_user)):
    """Erase this person. Irreversible, and it ends the session.

    DELETE and POST both, because a browser form cannot send DELETE and the
    public web page (the URL Play requires) is a form.
    """
    if (inp.confirm or "").strip() != CONFIRM_PHRASE:
        raise HTTPException(
            status_code=400,
            detail=f'Type {CONFIRM_PHRASE} to confirm.',
        )

    plan = await _plan(user)
    chosen = {t for t in (inp.delete_workspaces or []) if t}
    for w in plan["workspaces"]:
        if w["outcome"] == "blocked" and w["tenant_id"] in chosen:
            w["outcome"] = "workspace_deleted"
    plan["blocked"] = [w for w in plan["workspaces"] if w["outcome"] == "blocked"]
    if plan["blocked"]:
        # 409, not 403: nothing is wrong with who they are, the workspace is
        # in a state that has to be resolved first.
        raise HTTPException(status_code=409, detail={
            "message": ("You own a workspace other people are in. Choose to delete "
                        "it too, or remove them first."),
            "blocked": plan["blocked"],
        })

    from services.auth.membership import remove_membership
    from services.tenant_wipe import wipe_tenant

    # Read before anything is erased: each workspace's user row can carry its
    # own email, and those rows are about to go.
    norm = (user.get("phone_norm") or "").strip()
    emails = {(user.get("email") or "").strip().lower()}
    if norm:
        for r in await db.users.find({"phone_norm": norm}, {"_id": 0, "email": 1}).to_list(200):
            emails.add((r.get("email") or "").strip().lower())
    emails.discard("")

    deleted_workspaces, left_workspaces = [], []
    for w in plan["workspaces"]:
        tenant_id, user_id = w["tenant_id"], w["user_id"]
        if w["outcome"] == "workspace_deleted":
            report = await wipe_tenant(tenant_id)
            deleted_workspaces.append({
                "tenant_id": tenant_id, "name": w["tenant_name"],
                "records_removed": report.get("total_removed", 0),
                "files_deleted": report.get("files_deleted", 0),
            })
            continue
        # you_leave: the person goes, the company's history stays.
        await remove_membership(db, user_id=user_id, tenant_id=tenant_id)
        await db.memberships.delete_many({"user_id": user_id, "tenant_id": tenant_id})
        await db.users.delete_one({"id": user_id, "tenant_id": tenant_id})
        left_workspaces.append({"tenant_id": tenant_id, "name": w["tenant_name"]})

    # Anything still carrying this number: a workspace wipe above already took
    # its user row, so this catches only rows the plan could not see (a user
    # doc with no live membership, say). Without it the number stays taken and
    # the person cannot sign up again.
    stragglers = 0
    if norm:
        remaining = await db.users.find({"phone_norm": norm}, {"_id": 0, "id": 1}).to_list(200)
        for r in remaining:
            await db.memberships.delete_many({"user_id": r["id"]})
            stragglers += 1
        if remaining:
            await db.users.delete_many({"phone_norm": norm})

    user_ids = {w["user_id"] for w in plan["workspaces"] if w.get("user_id")}
    user_ids |= {r["id"] for r in (remaining if norm else []) if r.get("id")}
    if user.get("id"):
        user_ids.add(user["id"])
    await _erase_personal_traces(user_ids=user_ids, phone_norm=norm, emails=emails)

    # End the session properly — revoke the jti, not just the cookie, so a
    # copied token dies with the account.
    try:
        import jwt
        from core import JWT_SECRET, JWT_ALGORITHM, AUTH_COOKIE_NAME
        from services.auth.session_revocation import revoke as _revoke
        token = request.cookies.get(AUTH_COOKIE_NAME)
        if not token:
            hdr = request.headers.get("Authorization") or ""
            if hdr.startswith("Bearer "):
                token = hdr[7:].strip() or None
        if token:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM],
                                 options={"verify_exp": False})
            if payload.get("jti"):
                await _revoke(db, payload["jti"], exp=payload.get("exp"),
                              reason="account_deleted")
    except Exception:
        # An unreadable token is nothing to revoke; the account is gone either
        # way and get_current_user has nothing left to resolve.
        pass
    clear_auth_cookie(response)

    logger.info("account_deleted phone_hash=%s workspaces_deleted=%s left=%s at=%s",
                (norm[-4:] if norm else "?"), len(deleted_workspaces),
                len(left_workspaces), now_iso())
    return {
        "ok": True,
        "deleted": True,
        "workspaces_deleted": deleted_workspaces,
        "workspaces_left": left_workspaces,
        "accounts_removed": stragglers,
    }
