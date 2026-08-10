"""Compat shim — real module now at services/auth/onboarding_drafts.py."""
import sys
import services.auth.onboarding_drafts as _real
sys.modules[__name__] = _real
