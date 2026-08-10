"""Auth-domain services.

Groups the runtime services that gate + shape user identity:

  auth_emails         — email verification + password reset tokens (FIX-003-D)
  session_revocation  — JWT jti revocation on logout (FIX-003-C, S2-06)
  onboarding_drafts   — server-side wizard state persistence (FIX-001-D)
  phone               — phone-number normalization + tenant lookup (FIX-002-A, FIX-003-A)

Public API is re-exported here so callers can `from services.auth import
find_tenant_choices_for_phone` instead of the longer nested path. Old
`from services.<name> import X` imports keep working via the compat
shims at services/<name>.py that just re-export from here.
"""
from services.auth.auth_emails import (  # noqa: F401
    COLLECTION as AUTH_EMAIL_TOKENS_COLLECTION,
    KIND_EMAIL_VERIFY,
    KIND_PASSWORD_RESET,
    VALID_KINDS as AUTH_EMAIL_VALID_KINDS,
    issue as issue_auth_email_token,
    consume as consume_auth_email_token,
    invalidate_active_tokens as invalidate_active_auth_email_tokens,
    render_verify_email,
    render_reset_email,
)
from services.auth.session_revocation import (  # noqa: F401
    REVOKED_COLLECTION,
    revoke as revoke_session,
    is_revoked as is_session_revoked,
)
from services.auth.onboarding_drafts import *  # noqa: F401,F403
from services.auth.phone import (  # noqa: F401
    norm_phone,
    find_tenant_choices_for_phone,
)
from services.auth.draft_tokens import (  # noqa: F401
    sign_draft_id,
    verify_draft_token,
)
