"""Per-command rate limiting for the IPC layer (desktop adaptation).

There are no HTTP routes in a desktop app; the equivalent control is a
minimum call interval enforced per command name, plus a shared registry so
intervals are introspectable in tests.
"""

from __future__ import annotations

import functools
import threading
import time
from typing import Any, Callable, TypeVar

F = TypeVar("F", bound=Callable[..., Any])

_command_intervals_s: dict[str, float] = {}
_last_calls: dict[str, float] = {}
_lock = threading.Lock()


def rate_limit(
    min_interval_s: float,
    error_factory: Callable[[RateLimited], Exception] | None = None,
) -> Callable[[F], F]:
    """Decorator enforcing a minimum interval between invocations of a command.

    ``error_factory`` lets the IPC layer convert :class:`RateLimited` into its
    own error type (e.g. pytauri's InvokeException).
    """

    def decorator(func: F) -> F:
        command_name = func.__name__
        _command_intervals_s[command_name] = min_interval_s

        @functools.wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> Any:
            with _lock:
                now = time.monotonic()
                last = _last_calls.get(command_name)
                if last is not None and now - last < min_interval_s:
                    exc = RateLimited(command_name, min_interval_s)
                    raise error_factory(exc) if error_factory else exc
                _last_calls[command_name] = now
            return await func(*args, **kwargs)

        return wrapper  # type: ignore[return-value]

    return decorator


class RateLimited(Exception):
    def __init__(self, command: str, min_interval_s: float) -> None:
        super().__init__(
            f"command {command!r} called too frequently "
            f"(min interval {min_interval_s}s)"
        )


def reset_for_tests() -> None:
    with _lock:
        _last_calls.clear()


def get_interval(command: str) -> float | None:
    return _command_intervals_s.get(command)
