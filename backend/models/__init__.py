"""Pydantic request/response models, grouped by domain (Epic 8 Sprint 5).

Every API request/response shape lives in exactly one per-domain module here;
routers import from `models.<domain>` and nothing defines models inline anymore.
Import from the specific module (``from models.auth import LoginInput``) rather
than this package root.

Domain map
----------
    access.py       delegation / temp-grant shapes
    admin.py        platform-admin login + AI keys
    auth.py         register / login / 2FA / password-reset / profile / phone-OTP
    billing.py      Razorpay checkout
    brain.py        Company Brain ask / export / doc-patch / agent shapes
    calendar.py     leave-approver map
    captures.py     capture edit / review-action
    complaints.py   complaint + memory
    contacts.py     contact create / update
    crm.py          CRM activity
    decisions.py    decision comment
    desk.py         Decision Desk nudge
    finance.py      expense / asset / inventory / income / ledger-ask / ingest-commit
    inbox.py        inbox status
    onboarding.py   onboarding wizard + blueprint + draft shapes
    signup.py       email-check / website-intel / interview shapes
    tasks.py        task create / update / reassign / reject / exec-plan
    team.py         user create/update / attendance / leave / deprovision (+ LEAVE_TYPES)
    tenant.py       tenant config + settings (RoleItem, ProductItem, lexicon, roles, ai-keys, ...)
    voice.py        text-note + clarify
    workflows.py    workflow create / advance

Shared value objects (RoleItem, ProductItem) live in `models.tenant` and are
re-used by `models.auth`. Identical shapes were deduped in S5 (e.g. auth owns
ProfileUpdateInput / ChangePasswordInput; tenant_settings imports them).
"""
