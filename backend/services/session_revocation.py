"""Compat shim — real module now at services/auth/session_revocation.py."""
import sys
import services.auth.session_revocation as _real
sys.modules[__name__] = _real
