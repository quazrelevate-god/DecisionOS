"""Compat shim — real module now at services/auth/auth_emails.py.

`sys.modules` alias so `import services.auth_emails` and
`import services.auth.auth_emails` return the SAME module object.
Monkeypatching + underscored-name access work transparently.
"""
import sys
import services.auth.auth_emails as _real
sys.modules[__name__] = _real
