"""A screen says something quickly (2026-10-03).

The honest "couldn't load this" shipped in U7-25.72 took SEVEN AND A HALF
SECONDS to appear, and for most of that the page was neither loading nor
failed -- half-built and silent, which is the state a founder reads as broken.

MEASURED IN THE BROWSER, before and after, against a failing endpoint:

                        attempts   message at
    500 server error       4         7.67s   ->   2       1.30s
    403 refusal            4         7.61s   ->   1       0.27s

The second row is the one that was plainly wrong. react-query's default
retried a 403 three times: asking a server that had just said no, three more
times, to be told no three more times. A 4xx is an ANSWER, not a blip. The
only two worth asking again are 408 and 429, which are the server saying
"later" rather than "never".

One retry still covers what retries are for -- a single dropped request --
and the failure state carries a Try again button for anything longer, with
refetchOnWindowFocus and refetchOnReconnect for the factory-floor case.
"""
from pathlib import Path

INDEX = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "index.js").read_text(encoding="utf-8")


def test_a_refusal_is_not_retried():
    assert "if (status >= 400 && status < 500 && !RETRY_ANYWAY.has(status)) return false;" in INDEX


def test_later_is_not_never():
    """408 and 429 are the server asking for a moment, not refusing."""
    assert "const RETRY_ANYWAY = new Set([408, 429]);" in INDEX


def test_one_retry_for_everything_else():
    assert "return failureCount < 1;" in INDEX


def test_the_policy_is_on_the_client_so_every_list_gets_it():
    at = INDEX.index("new QueryClient(")
    block = INDEX[at:at + 700]
    assert "defaultOptions" in block and "retry: (failureCount, error)" in block


def test_what_recovers_a_longer_outage_is_still_there():
    """The retry budget was cut, not the recovery: focus, reconnect and the
    Try again button are what a real outage comes back through."""
    assert "refetchOnWindowFocus: true" in INDEX
    assert "refetchOnReconnect: true" in INDEX


def test_the_measurements_are_written_down():
    """So the next person to widen this meets the numbers first."""
    assert "7.67" in INDEX and "FOUR attempts" in INDEX
    assert "403" in INDEX
