"""Compat shim — real module now at services/auth/phone.py."""
import sys
import services.auth.phone as _real
sys.modules[__name__] = _real
