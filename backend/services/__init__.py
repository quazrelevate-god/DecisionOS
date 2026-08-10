"""Business services + external integrations for DecisionOS.

Structure (post-modularization):

  services/
    auth/                    — user identity + session + email + phone
      auth_emails.py           email verification + password reset tokens (FIX-003-D)
      session_revocation.py    JWT jti revocation on logout (FIX-003-C, S2-06)
      onboarding_drafts.py     server-side wizard state persistence (FIX-001-D)
      phone.py                 phone-number normalization + tenant lookup (FIX-002-A, FIX-003-A)
    ai/                      — LLM + agentic + AI infra
      ai_setup.py              AI generators with status tracking (FIX-001-D)
      brain_context.py         decision-context capture (Brain writes + RAG source)
      brain_rbac.py            intent classifier + role gate
      llm_limits.py            timeout + semaphore for shared LLM key (FIX-002-B, S1-05)
    tenancy.py               — ensure_owned/tenant_filter helpers (FIX-001-C)
    workflows.py             — tenant-dynamic pipeline resolution (FIX-001-A/F)
    uploads.py               — obj_store abstraction (FIX-002-E, S1-03)
    obj_store.py             — Emergent Object Storage wrapper
    migrations.py            — MongoDB migration ledger (FIX-002-C)
    leader_lock.py           — distributed leader lock (FIX-002-D, S1-01)
    tasks.py                 — task enrichment + activity helpers

Compat shims: the top-level services/{ai_setup,auth_emails,brain_context,
brain_rbac,llm_limits,onboarding_drafts,phone,session_revocation}.py
files re-export from the subpackages so every existing
`from services.X import Y` import keeps working. Migrate call sites to
the subpackage paths over time; the shims can be deleted once no
downstream imports use the old paths (grep proves it).
"""
