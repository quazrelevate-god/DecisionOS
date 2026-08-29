"""T10-11.2 Phase-1 spike -- ephemeral live server on an ISOLATED test DB.

Boots `uvicorn server:app` against a throwaway Mongo database (same server,
unique db name -- NEVER founder-os-58), waits for the background bootstrap to
finish seeding the demo tenant + platform admin, exposes the base URL, and on
exit kills the server and drops the database.

Why this works with zero changes to the 55 HTTP integration tests: the app's
bootstrap self-seeds exactly the identities those tests log in as
(admin@decisionos.biz / owner@sharma.com / sales@sharma.com). We only have to
(a) point DB_NAME at an isolated database and (b) pin SUPERADMIN_* to the
values the tests hardcode (otherwise backend/.env's own SUPERADMIN_* would seed
a different admin).

server.py calls `load_dotenv(override=False)`, so overrides we place in the
child env win, while MONGO_URL / JWT_SECRET / EMERGENT_LLM_KEY still come from
backend/.env.

Run the spike directly:
    .venv/Scripts/python.exe tests/_live_harness.py tests/test_iteration60_admin.py
"""
import contextlib
import os
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path

import httpx

_BACKEND = Path(__file__).resolve().parent.parent
_DEV_DB_NAME = "founder-os-58"  # the one database we must NEVER touch

# Credentials the integration suite hardcodes (bootstrap seeds these in non-prod).
_ADMIN_EMAIL = "admin@decisionos.biz"
_ADMIN_PASSWORD = "DecisionOS@2026"
_OWNER_EMAIL = "owner@sharma.com"
_OWNER_PASSWORD = "demo1234"


def _mongo_url() -> str:
    url = os.environ.get("MONGO_URL")
    if url:
        return url
    from dotenv import dotenv_values
    env = _BACKEND / ".env"
    if env.exists():
        val = dotenv_values(env).get("MONGO_URL")
        if val:
            return val
    raise RuntimeError("MONGO_URL not set (env or backend/.env) -- cannot run live harness")


def _fresh_db_name() -> str:
    name = f"dos_test_live_{os.getpid()}_{uuid.uuid4().hex[:10]}"
    assert name != _DEV_DB_NAME
    return name


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _drop_db(db_name: str) -> None:
    """Drop the throwaway database. Guard-railed against the dev DB."""
    if not db_name or db_name == _DEV_DB_NAME or not db_name.startswith("dos_test_"):
        raise RuntimeError(f"refusing to drop non-test database {db_name!r}")
    try:
        from pymongo import MongoClient
        cli = MongoClient(_mongo_url(), serverSelectionTimeoutMS=8000)
        cli.drop_database(db_name)
        cli.close()
    except Exception as exc:  # teardown must never mask the test result
        print(f"[live-harness] WARN: failed to drop {db_name}: {exc}", file=sys.stderr)


@contextlib.contextmanager
def live_server(seed_timeout: float = 120.0, log_path: Path | None = None):
    """Yield the base URL of a booted server backed by a fresh isolated DB."""
    db_name = _fresh_db_name()
    port = _free_port()
    base = f"http://127.0.0.1:{port}"

    env = os.environ.copy()
    env["DB_NAME"] = db_name                       # isolated -- wins over .env
    # Pin every seeded identity to the values the integration suite hardcodes.
    # backend/.env sets its own SUPERADMIN_* and DEMO_* -- since server.py does
    # load_dotenv(override=False), our child-env values win, so the seed
    # produces admin@decisionos.biz / owner@sharma.com regardless of the dev's
    # personal .env.
    env["SUPERADMIN_EMAIL"] = _ADMIN_EMAIL
    env["SUPERADMIN_PASSWORD"] = _ADMIN_PASSWORD
    env["DEMO_EMAIL"] = _OWNER_EMAIL
    env["DEMO_PASSWORD"] = _OWNER_PASSWORD
    env["ENV"] = "dev"                             # non-prod so the seed runs
    env["AUTH_RETURN_TOKEN"] = "1"                 # login must return token in body (tests read r.json()["token"])
    env["COOKIE_SECURE"] = "0"                     # http://127.0.0.1: `requests` only sends non-Secure cookies
    env["PYTHONUNBUFFERED"] = "1"

    log_path = log_path or (_BACKEND / f".live_server_{port}.log")
    logf = open(log_path, "w", encoding="utf-8")
    print(f"[live-harness] booting server on {base} (DB={db_name})")
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "server:app",
         "--host", "127.0.0.1", "--port", str(port), "--no-access-log"],
        cwd=str(_BACKEND), env=env, stdout=logf, stderr=subprocess.STDOUT,
    )
    try:
        _wait_ready(base, proc, seed_timeout, log_path, db_name)
        yield base
    finally:
        with contextlib.suppress(Exception):
            proc.terminate()
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                proc.kill()
        logf.close()
        _drop_db(db_name)
        with contextlib.suppress(Exception):
            os.remove(log_path)
        print(f"[live-harness] torn down (dropped {db_name})")


def _wait_ready(base: str, proc: subprocess.Popen, seed_timeout: float, log_path: Path, db_name: str) -> None:
    deadline = time.time() + seed_timeout
    # 1) TCP + /api/health -- the port is bound and the app answers.
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"server exited early (code {proc.returncode}). Log:\n{_tail(log_path)}")
        with contextlib.suppress(Exception):
            r = httpx.get(f"{base}/api/health", timeout=3)
            if r.status_code < 500:
                break
        time.sleep(0.5)
    else:
        raise RuntimeError(f"server never became healthy. Log:\n{_tail(log_path)}")

    # 2) Seed-complete. IMPORTANT: do NOT poll /auth/login here -- before the
    #    seed lands the owner doesn't exist, so each probe is a FAILED login
    #    that trips the brute-force rate limiter (429 "Too many failed
    #    attempts. Try again in 15 min."), which then locks out the real tests.
    #    Poll the isolated DB directly instead: zero HTTP, zero login attempts.
    from pymongo import MongoClient
    cli = MongoClient(_mongo_url(), serverSelectionTimeoutMS=8000)
    try:
        tdb = cli[db_name]
        while time.time() < deadline:
            if proc.poll() is not None:
                raise RuntimeError(f"server exited during seed (code {proc.returncode}). Log:\n{_tail(log_path)}")
            owner = tdb.users.find_one({"email": _OWNER_EMAIL})
            admin = tdb.platform_admins.find_one({"email": _ADMIN_EMAIL})
            if owner and admin:
                print("[live-harness] seed complete (demo owner + platform admin present in DB)")
                return
            time.sleep(1.0)
    finally:
        cli.close()
    raise RuntimeError(f"seed never completed within {seed_timeout}s. Log:\n{_tail(log_path)}")


def _tail(path: Path, n: int = 40) -> str:
    with contextlib.suppress(Exception):
        return "\n".join(path.read_text(encoding="utf-8", errors="replace").splitlines()[-n:])
    return "<no log>"


if __name__ == "__main__":
    import pytest
    # No args -> run the whole `integration` tier against the booted server (the
    # CI command). Pass explicit paths/flags to scope it (e.g. one file locally).
    args = sys.argv[1:] or ["-m", "integration", "tests/"]
    with live_server() as url:
        os.environ["REACT_APP_BACKEND_URL"] = url
        print(f"[live-harness] running: {args}  (REACT_APP_BACKEND_URL={url})")
        code = pytest.main(["-o", "addopts=", "-q", *args])
    sys.exit(code)
