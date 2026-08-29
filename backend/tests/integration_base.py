"""T10-11.2 Phase 2 -- one fail-closed source for the live-integration base URL.

Every HTTP integration test resolves its server URL through `base_url()` so the
suite can NEVER silently fall back to a shared remote/hosted environment. Before
this, ~45 files defaulted to a hardcoded hosted-preview URL (or read
frontend/.env, which points at a deployed backend), so a run with no env set
would fire real register / create / delete calls at a shared server.

The ONLY trusted source here is the REACT_APP_BACKEND_URL process env var, which
`tests/_live_harness.py` (isolated-DB local server) and CI set explicitly. If it
is unset we SKIP the module -- we do not guess a default and do not read
frontend/.env. To target a remote server you control, export the var yourself.
"""
import os

import pytest

_SKIP_MSG = (
    "REACT_APP_BACKEND_URL not set -- live-integration test skipped. Run it via "
    "`python tests/_live_harness.py tests/<file>` (spins up an isolated-DB local "
    "server) or export REACT_APP_BACKEND_URL to point at a server you control. "
    "The suite deliberately no longer defaults to any shared/hosted environment."
)


def base_url() -> str:
    """Return the integration base URL from the environment, or skip the module.

    Call this at module top: `BASE_URL = base_url()`. When the env var is unset
    it raises a module-level skip (not a KeyError, not a silent remote default).
    """
    url = (os.environ.get("REACT_APP_BACKEND_URL") or "").strip().rstrip("/")
    if not url:
        pytest.skip(_SKIP_MSG, allow_module_level=True)
    return url
