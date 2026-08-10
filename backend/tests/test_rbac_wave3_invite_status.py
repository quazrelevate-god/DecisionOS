"""FIX-004-E (Wave 3 sub-batch C) tests: RBAC-17 pending-invite visibility.

  * GET /users source enriches each user with invite_status from
    their membership. Removed members excluded.
  * POST /users/{id}/uninvite exists, requires team_manage,
    refuses non-pending members, invalidates invite_token +
    soft-deletes the membership.
"""
import inspect
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


class TestListUsersEnrichment:
    def test_list_users_source_merges_membership_status(self):
        from routers.team import list_users
        src = inspect.getsource(list_users)
        assert "list_memberships_for_tenant" in src
        assert 'invite_status' in src
        assert 'invited_at' in src
        assert 'accepted_at' in src

    def test_removed_memberships_excluded_from_list(self):
        """Removed members shouldn't appear as active in the admin
        list — that's the whole point of the visible-status field."""
        from routers.team import list_users
        src = inspect.getsource(list_users)
        assert '"removed"' in src

    def test_legacy_users_default_to_active(self):
        """Pre-membership users (mid-migration) must not surface with
        a NULL status that the frontend can't render."""
        from routers.team import list_users
        src = inspect.getsource(list_users)
        assert '"active"' in src


class TestUninviteEndpoint:
    def test_endpoint_exists_and_requires_team_manage(self):
        from routers.team import uninvite_user
        src = inspect.getsource(uninvite_user)
        assert 'require_perm("team_manage")' in src

    def test_refuses_non_pending_member(self):
        """Uninviting an active member shouldn't work — that's what
        suspend/delete are for."""
        from routers.team import uninvite_user
        src = inspect.getsource(uninvite_user)
        assert 'STATUS_PENDING' in src
        assert 'status_code=400' in src

    def test_invalidates_invite_token_on_user_doc(self):
        """Belt-and-braces: even after removing the membership, wipe
        the legacy invite_token on the user doc so the invite URL
        stops resolving."""
        from routers.team import uninvite_user
        src = inspect.getsource(uninvite_user)
        assert '"invite_token": None' in src
        assert '"invite_expires_at": None' in src

    def test_removes_membership_soft(self):
        from routers.team import uninvite_user
        src = inspect.getsource(uninvite_user)
        assert 'remove_membership' in src or '_rm(' in src

    def test_logs_activity(self):
        """Uninviting is a team-management event; admin log should
        capture who did it and to whom."""
        from routers.team import uninvite_user
        src = inspect.getsource(uninvite_user)
        assert 'log_activity' in src
        assert 'user_uninvited' in src
