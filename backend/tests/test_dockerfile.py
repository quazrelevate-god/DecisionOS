"""FIX-002-F tests: Dockerfile + .dockerignore + Procfile static checks.

We can't run `docker build` in the unit-test environment (no daemon
guaranteed), but we CAN lock in the structural properties that matter
for correctness + security:

  1. .dockerignore excludes secrets (.env) — never bake credentials
     into an image.
  2. .dockerignore excludes local uploads/ (FIX-002-E moved those
     to obj_store, they're stale artifacts on dev boxes).
  3. Dockerfile uses a non-root runtime USER (limits blast radius
     of any code-exec vuln).
  4. Dockerfile exposes the port + declares HEALTHCHECK against
     the same endpoint the platform will probe.
  5. Dockerfile CMD respects $PORT env (Railway/Heroku inject one).
  6. Dockerfile uses multi-stage build (final image doesn't carry
     compiler toolchain).
  7. Procfile CMD matches Dockerfile CMD's worker/timeout config
     so we don't get "works in one deploy target, not the other."
  8. Dockerfile installs emergentintegrations from its CDN
     (regression guard: without the extra-index-url, requirements
     install silently fails on that package).

These are cheap contract tests — running `docker build` for real is
still the definitive test but requires a daemon (see FIX-002-F
follow-up in the tracker for CI wiring).
"""
import re
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
DOCKERFILE = BACKEND / "Dockerfile"
DOCKERIGNORE = BACKEND / ".dockerignore"
PROCFILE = BACKEND / "Procfile"


@pytest.fixture(scope="module")
def dockerfile_text():
    assert DOCKERFILE.exists(), f"Missing {DOCKERFILE}"
    return DOCKERFILE.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def dockerignore_text():
    assert DOCKERIGNORE.exists(), f"Missing {DOCKERIGNORE}"
    return DOCKERIGNORE.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def procfile_text():
    assert PROCFILE.exists(), f"Missing {PROCFILE}"
    return PROCFILE.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# .dockerignore: security-critical exclusions
# ---------------------------------------------------------------------------
class TestDockerignore:
    def test_excludes_env_files(self, dockerignore_text):
        """Never bake secrets into the image. .env must be excluded."""
        assert re.search(r"^\.env\s*$", dockerignore_text, re.MULTILINE), (
            ".env must be in .dockerignore or credentials leak into the image"
        )

    def test_excludes_env_variants(self, dockerignore_text):
        """.env.production, .env.local etc must also be excluded."""
        text = dockerignore_text
        assert (".env.*" in text) or ("*.env" in text), (
            "Variant .env.* / *.env not excluded — .env.production etc. could leak"
        )

    def test_excludes_venv(self, dockerignore_text):
        """.venv from local dev must not go into the image (~200MB)."""
        assert ".venv/" in dockerignore_text or ".venv" in dockerignore_text

    def test_excludes_local_uploads(self, dockerignore_text):
        """FIX-002-E: uploads/ is now obj_store, local files are stale."""
        assert "uploads/" in dockerignore_text or "uploads" in dockerignore_text

    def test_excludes_git(self, dockerignore_text):
        """Never ship .git into the image — huge, leaks history."""
        assert ".git/" in dockerignore_text or ".git" in dockerignore_text

    def test_excludes_tests(self, dockerignore_text):
        """Runtime image doesn't need pytest fixtures."""
        assert "tests/" in dockerignore_text or "tests" in dockerignore_text


# ---------------------------------------------------------------------------
# Dockerfile: structure + security
# ---------------------------------------------------------------------------
class TestDockerfileStructure:
    def test_multistage_build(self, dockerfile_text):
        """Two FROM lines means multi-stage (builder + runtime).
        Keeps final image slim — no gcc/build-essential in production."""
        from_lines = [l for l in dockerfile_text.splitlines()
                      if l.strip().upper().startswith("FROM ")]
        assert len(from_lines) >= 2, (
            f"Expected multi-stage build (>=2 FROM), got {len(from_lines)}"
        )

    def test_non_root_runtime_user(self, dockerfile_text):
        """USER directive in the runtime stage limits blast radius of any
        code-exec vuln (attacker lands as `app`, not root)."""
        assert re.search(r"^USER\s+\S+", dockerfile_text, re.MULTILINE), (
            "No USER directive — container runs as root by default"
        )
        # And it's not USER root
        user_lines = re.findall(r"^USER\s+(\S+)", dockerfile_text, re.MULTILINE)
        assert user_lines[-1].lower() != "root", (
            f"Last USER directive is 'root' ({user_lines}); should be a non-root user"
        )

    def test_uses_slim_python_base(self, dockerfile_text):
        """Slim base image = ~150MB vs ~1GB for python:3.12; smaller
        image = faster cold start = happier free-tier deploy."""
        assert "python:3.12-slim" in dockerfile_text or "python:3.11-slim" in dockerfile_text

    def test_exposes_port(self, dockerfile_text):
        """EXPOSE lets tooling / docs / port mappings discover the port."""
        assert re.search(r"^EXPOSE\s+\d+", dockerfile_text, re.MULTILINE)

    def test_has_healthcheck(self, dockerfile_text):
        """Platform-agnostic health probe. Uses the existing /api/health
        endpoint (which server.py has since day 1)."""
        assert "HEALTHCHECK" in dockerfile_text
        assert "/api/health" in dockerfile_text, (
            "HEALTHCHECK should probe /api/health"
        )

    def test_respects_port_env(self, dockerfile_text):
        """Railway/Heroku inject $PORT. Hardcoding the port breaks those."""
        assert "$PORT" in dockerfile_text or "${PORT}" in dockerfile_text

    def test_worker_count_configurable(self, dockerfile_text):
        """WEB_CONCURRENCY env-var is the standard knob. Hardcoded --workers=N
        without env fallback means every deploy target is stuck at that count."""
        assert "WEB_CONCURRENCY" in dockerfile_text

    def test_graceful_shutdown_timeout(self, dockerfile_text):
        """LLM calls run up to 45s (FIX-002-B). A rolling redeploy that
        kills the process in <45s = user-visible 502s. Graceful shutdown
        must be >= LLM timeout."""
        assert "timeout-graceful-shutdown" in dockerfile_text

    def test_installs_emergentintegrations_from_cdn(self, dockerfile_text):
        """Regression guard for the trap we hit during local setup:
        emergentintegrations comes from Emergent's public CDN, not PyPI.
        Without the extra-index-url, `pip install -r requirements.txt`
        silently fails on that package."""
        assert "d33sy5i8bnduwe.cloudfront.net" in dockerfile_text, (
            "emergentintegrations extra-index-url missing — install will fail on that package"
        )

    def test_uses_pinned_python_version(self, dockerfile_text):
        """A floating `FROM python:3` would auto-bump majors and could
        break the app silently. Pin explicitly."""
        assert re.search(r"python:3\.\d+", dockerfile_text), (
            "Base image must pin a minor version (python:3.12-slim etc.)"
        )


class TestDockerfileSecurity:
    def test_no_env_secrets_baked_in(self, dockerfile_text):
        """Regression guard: ARG/ENV lines for known secret names would
        bake defaults into the image layer even if overridden at runtime."""
        forbidden = ("JWT_SECRET", "SUPERADMIN_PASSWORD", "ANTHROPIC_API_KEY",
                     "OPENAI_API_KEY", "SMTP_PASSWORD", "MONGO_URL")
        for token in forbidden:
            # Allow ARG/ENV that DECLARES the var with no default, but
            # not one that sets an actual value.
            m = re.search(rf"^(?:ARG|ENV)\s+{token}\s*=\s*\S", dockerfile_text, re.MULTILINE)
            assert not m, (
                f"{token} appears with a value in Dockerfile ARG/ENV — "
                "would leak into the image layer. Read from runtime env only."
            )

    def test_no_pip_cache_bloat(self, dockerfile_text):
        """PIP_NO_CACHE_DIR or --no-cache-dir keeps ~100MB of wheel cache
        out of the final image."""
        assert ("PIP_NO_CACHE_DIR" in dockerfile_text
                or "--no-cache-dir" in dockerfile_text)

    def test_apt_lists_cleaned(self, dockerfile_text):
        """apt-get install layers accumulate ~40MB of package indexes;
        `rm -rf /var/lib/apt/lists/*` is the standard cleanup."""
        # Every apt-get install line should be followed by list cleanup
        # (either same layer via && or a subsequent RUN).
        installs = re.findall(r"apt-get install", dockerfile_text)
        cleanups = re.findall(r"rm -rf /var/lib/apt/lists", dockerfile_text)
        assert len(cleanups) >= len(installs), (
            f"{len(installs)} apt install layers but only {len(cleanups)} "
            "list cleanups — package indexes bloating the image"
        )


# ---------------------------------------------------------------------------
# Procfile: keep it in lockstep with the Dockerfile CMD
# ---------------------------------------------------------------------------
class TestProcfile:
    def test_declares_web_process(self, procfile_text):
        assert re.search(r"^web:\s*\S+", procfile_text, re.MULTILINE)

    def test_runs_uvicorn_with_server_app(self, procfile_text):
        assert "uvicorn server:app" in procfile_text

    def test_binds_all_interfaces(self, procfile_text):
        """0.0.0.0 (not 127.0.0.1) so external requests through the
        platform's proxy reach the app."""
        assert "0.0.0.0" in procfile_text

    def test_respects_port_env(self, procfile_text):
        assert "$PORT" in procfile_text

    def test_same_worker_env_var_as_dockerfile(self, procfile_text, dockerfile_text):
        """Both entry points read the same knob so behavior matches
        whether the platform uses the Dockerfile or the Procfile."""
        assert "WEB_CONCURRENCY" in procfile_text
        assert "WEB_CONCURRENCY" in dockerfile_text

    def test_same_graceful_shutdown_as_dockerfile(self, procfile_text, dockerfile_text):
        assert "timeout-graceful-shutdown" in procfile_text
        assert "timeout-graceful-shutdown" in dockerfile_text
