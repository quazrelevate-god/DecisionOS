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
                     choose, so we refuse and say what to do: hand ownership
                     over, or remove everyone first.

A blocker stops the WHOLE request, not just that workspace. Half-deleting
somebody and reporting partial success is worse than not starting: they think
they are gone, and they are not.
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from core import db, logger, now_iso, get_current_user, clear_auth_cookie

router = APIRouter(prefix="/api/account")

# Typed by the person, exactly, before anything is erased. Not a checkbox: the
# whole point is a deliberate act that a mis-tap cannot produce.
CONFIRM_PHRASE = "DELETE"


class DeleteAccountInput(BaseModel):
    confirm: str


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
            entry["reason"] = (
                f"You own this workspace and {len(others)} other "
                f"{'person is' if len(others) == 1 else 'people are'} in it. "
                "Make someone else the owner first, or remove them — we won't "
                "delete a company other people are working in, and we won't "
                "leave it without an owner."
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
    if plan["blocked"]:
        # 409, not 403: nothing is wrong with who they are, the workspace is
        # in a state that has to be resolved first.
        raise HTTPException(status_code=409, detail={
            "message": "Some workspaces have to be handed over first.",
            "blocked": plan["blocked"],
        })

    from services.auth.membership import remove_membership
    from services.tenant_wipe import wipe_tenant

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
    norm = (user.get("phone_norm") or "").strip()
    stragglers = 0
    if norm:
        remaining = await db.users.find({"phone_norm": norm}, {"_id": 0, "id": 1}).to_list(200)
        for r in remaining:
            await db.memberships.delete_many({"user_id": r["id"]})
            stragglers += 1
        if remaining:
            await db.users.delete_many({"phone_norm": norm})

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
