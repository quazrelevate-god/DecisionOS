"""The versions of the documents people agree to.

2026-10-08 (Play audit C2). Google Play's User Generated Content policy
requires that people accept the app's terms before they can create content
other people see. Members join by invite and never pass through signup, so
acceptance is recorded per person (`users.terms_accepted`) and asked for in the
app until it matches TERMS_VERSION.

Bump TERMS_VERSION when the Terms of Service change materially; everybody is
asked again on their next visit. Keep frontend/src/lib/legal.js in step.
"""
TERMS_VERSION = "2026-10-08"
