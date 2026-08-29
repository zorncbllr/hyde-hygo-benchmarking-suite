"""Tests for the IPC rate limiter (pytauri-free module)."""

import pytest

from suite.ratelimit import RateLimited, get_interval, rate_limit, reset_for_tests


@pytest.fixture(autouse=True)
def _reset():
    reset_for_tests()
    yield
    reset_for_tests()


def test_first_call_passes_second_throttled():
    calls = []

    @rate_limit(60.0)
    async def cmd():
        calls.append(1)
        return "ok"

    import asyncio

    assert asyncio.run(cmd()) == "ok"
    with pytest.raises(RateLimited):
        asyncio.run(cmd())
    assert len(calls) == 1


def test_error_factory_converts_exception():
    class IPCError(Exception):
        pass

    @rate_limit(60.0, error_factory=lambda e: IPCError(str(e)))
    async def cmd():
        return "ok"

    import asyncio

    asyncio.run(cmd())
    with pytest.raises(IPCError, match="called too frequently"):
        asyncio.run(cmd())


def test_interval_registry():
    @rate_limit(0.25)
    async def my_command():
        return None

    assert get_interval("my_command") == 0.25
    assert get_interval("unknown") is None


def test_different_commands_independent():
    @rate_limit(60.0)
    async def a():
        return "a"

    @rate_limit(60.0)
    async def b():
        return "b"

    import asyncio

    assert asyncio.run(a()) == "a"
    assert asyncio.run(b()) == "b"
