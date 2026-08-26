"""FIX-002-B tests: LLM call timeout + concurrency semaphore.

The bug this closes: LLM calls had no timeout and no concurrency cap.
50 concurrent voice-capture requests contended on one shared Anthropic
key, cascading into 429s + unbounded latency. Fix wraps every LLM call
in a shared asyncio.Semaphore + asyncio.wait_for.

Tests here:
  1. Env-driven config parses defaults + honors overrides.
  2. Semaphore actually caps concurrency (verified by tracking peak
     in-flight during a burst).
  3. wait_for timeout fires on slow calls; other in-flight calls are
     unaffected.
  4. Timeout / concurrency override at call site works (admin probe
     uses timeout=25).
  5. Exceptions from the wrapped coroutine propagate unchanged so
     existing try/except blocks around send_message keep working.

Pure unit tests — mocks the LLM call with asyncio.sleep and side-effect
counters. No live network.
"""
import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

from services.ai import llm_limits as ll


class TestConfigParsing:
    def test_defaults_present(self):
        assert ll.LLM_TIMEOUT_SECONDS >= 5
        assert ll.LLM_MAX_CONCURRENT >= 1

    def test_config_snapshot_shape(self):
        s = ll.config_snapshot()
        assert set(s.keys()) == {"llm_timeout_seconds", "llm_max_concurrent"}
        assert isinstance(s["llm_timeout_seconds"], int)
        assert isinstance(s["llm_max_concurrent"], int)

    def test_read_int_env_returns_default_on_missing(self, monkeypatch):
        monkeypatch.delenv("MADE_UP_VAR", raising=False)
        assert ll._read_int_env("MADE_UP_VAR", 42) == 42

    def test_read_int_env_parses_valid(self, monkeypatch):
        monkeypatch.setenv("MADE_UP_VAR", "99")
        assert ll._read_int_env("MADE_UP_VAR", 42) == 99

    def test_read_int_env_ignores_junk(self, monkeypatch):
        monkeypatch.setenv("MADE_UP_VAR", "not_an_int")
        assert ll._read_int_env("MADE_UP_VAR", 42) == 42

    def test_read_int_env_enforces_minimum(self, monkeypatch):
        """A fat-fingered '0' or negative value can't disable the guard."""
        monkeypatch.setenv("MADE_UP_VAR", "0")
        assert ll._read_int_env("MADE_UP_VAR", 42, minimum=1) == 1
        monkeypatch.setenv("MADE_UP_VAR", "-5")
        assert ll._read_int_env("MADE_UP_VAR", 42, minimum=1) == 1


class TestGuardedLlmBasic:
    def test_success_passes_result_through(self):
        async def fake_call():
            return "ok"
        result = asyncio.run(ll.guarded_llm(fake_call()))
        assert result == "ok"

    def test_exception_propagates_unchanged(self):
        """Existing try/except blocks around send_message must keep
        catching provider errors verbatim."""
        class MyErr(Exception):
            pass
        async def fake_call():
            raise MyErr("provider blew up")
        with pytest.raises(MyErr, match="provider blew up"):
            asyncio.run(ll.guarded_llm(fake_call()))

    def test_timeout_raises_TimeoutError(self, monkeypatch):
        """A slow call must be cut off. Use per-call timeout override
        so we don't wait 45 seconds in the test suite."""
        async def slow_call():
            await asyncio.sleep(2.0)
            return "should never reach"
        with pytest.raises(asyncio.TimeoutError):
            asyncio.run(ll.guarded_llm(slow_call(), timeout=1))

    def test_per_call_timeout_override_respected(self):
        """A caller that wants a tighter bound (e.g. admin probe wants 25s,
        not the default 45s) can pass timeout=."""
        async def just_fits():
            await asyncio.sleep(0.05)
            return "done"
        # 1s cap easily accommodates a 50ms call
        result = asyncio.run(ll.guarded_llm(just_fits(), timeout=1))
        assert result == "done"


class TestSemaphoreCapsConcurrency:
    def test_burst_of_calls_capped_at_max_concurrent(self, monkeypatch):
        """The whole point of FIX-002-B: fire more calls than the cap
        allows, verify only `cap` run at once and the rest wait."""
        # Force a small cap for the test
        monkeypatch.setattr(ll, "LLM_MAX_CONCURRENT", 3)
        ll._reset_for_test()  # rebuild semaphore with the new cap

        in_flight = 0
        peak_in_flight = 0
        completed = 0
        lock = asyncio.Lock()

        async def tracked_call():
            nonlocal in_flight, peak_in_flight, completed
            async with lock:
                in_flight += 1
                peak_in_flight = max(peak_in_flight, in_flight)
            # Simulate work so overlapping is guaranteed
            await asyncio.sleep(0.05)
            async with lock:
                in_flight -= 1
                completed += 1
            return "done"

        async def burst():
            # Fire 10 concurrent calls at a cap of 3
            tasks = [ll.guarded_llm(tracked_call(), timeout=5) for _ in range(10)]
            results = await asyncio.gather(*tasks)
            return results

        results = asyncio.run(burst())
        assert completed == 10
        assert all(r == "done" for r in results)
        assert peak_in_flight <= 3, (
            f"cap of 3 was violated: peak concurrent = {peak_in_flight}"
        )
        # And we saturated the cap (not just processed sequentially)
        assert peak_in_flight >= 2, (
            f"cap of 3 should let at least 2 run in parallel; got {peak_in_flight}"
        )

    def test_timeout_releases_semaphore_slot(self, monkeypatch):
        """A timed-out call must release its slot; otherwise a single stuck
        request would permanently reduce the cap by 1."""
        monkeypatch.setattr(ll, "LLM_MAX_CONCURRENT", 1)
        ll._reset_for_test()

        # First call: hangs forever, gets cut off by timeout=0.3s
        async def hanger():
            await asyncio.sleep(60)

        # Second call: must be able to run once the first times out.
        # If the slot wasn't released, this would block indefinitely.
        async def quick():
            return "ok"

        async def sequence():
            # Fire the hanger; expect it to time out
            with pytest.raises(asyncio.TimeoutError):
                await ll.guarded_llm(hanger(), timeout=0.3)
            # Now the slot must be free again
            result = await asyncio.wait_for(
                ll.guarded_llm(quick(), timeout=2), timeout=2)
            return result

        assert asyncio.run(sequence()) == "ok"

    def test_exception_releases_semaphore_slot(self, monkeypatch):
        """Same guarantee for exceptions: a failing call must not leak
        its semaphore slot."""
        monkeypatch.setattr(ll, "LLM_MAX_CONCURRENT", 1)
        ll._reset_for_test()

        async def boom():
            raise RuntimeError("kaboom")

        async def quick():
            return "recovered"

        async def sequence():
            with pytest.raises(RuntimeError, match="kaboom"):
                await ll.guarded_llm(boom())
            return await ll.guarded_llm(quick())

        assert asyncio.run(sequence()) == "recovered"


class TestLabelObservability:
    """The `label` argument doesn't change behavior but is critical for
    ops to see WHICH call path is choking under load."""

    def test_label_appears_in_timeout_log(self, monkeypatch, caplog):
        """When a call times out, the log line must include the label so
        an on-call engineer can trace which module was stuck."""
        import logging
        monkeypatch.setattr(ll, "LLM_MAX_CONCURRENT", 1)
        ll._reset_for_test()

        async def slow():
            await asyncio.sleep(2)

        with caplog.at_level(logging.WARNING, logger="decisionos"):
            with pytest.raises(asyncio.TimeoutError):
                asyncio.run(ll.guarded_llm(slow(), label="my-critical-path", timeout=0.1))

        joined = " ".join(r.getMessage() for r in caplog.records)
        assert "my-critical-path" in joined, (
            f"label 'my-critical-path' missing from log; got: {joined!r}"
        )
