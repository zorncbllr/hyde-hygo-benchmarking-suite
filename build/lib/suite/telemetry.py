"""Telemetry helpers: rate-limited event emission and 3D surface meshes."""

from __future__ import annotations

import time
from collections import OrderedDict
from typing import Any, Callable

import numpy as np
from pydantic import BaseModel

TELEMETRY_MIN_INTERVAL_S = 0.1
SURFACE_RESOLUTION = 60
SURFACE_CACHE_SIZE = 16


class ThrottledEmitter:
    """Wraps an ``emit(event, payload)`` callable and drops telemetry events
    arriving faster than ``min_interval`` per channel.

    Non-telemetry events pass through unthrottled. Any event whose channel
    differs from the previous one also passes through (phase changes matter
    more than cadence).
    """

    def __init__(
        self,
        emit: Callable[[str, BaseModel], None],
        min_interval: float = TELEMETRY_MIN_INTERVAL_S,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._emit = emit
        self._min_interval = min_interval
        self._clock = clock
        self._last: dict[str, float] = {}

    def __call__(self, event: str, payload: BaseModel) -> None:
        channel = f"{event}:{getattr(payload, 'algo_key', '')}"
        now = self._clock()
        last = self._last.get(channel)
        if (
            event == "benchmark://telemetry"
            and last is not None
            and now - last < self._min_interval
        ):
            return
        self._last[channel] = now
        self._emit(event, payload)


class SurfaceCache:
    """LRU cache of precomputed meshgrid surfaces for 2D functions."""

    def __init__(self, resolution: int = SURFACE_RESOLUTION) -> None:
        self._resolution = resolution
        self._cache: OrderedDict[str, dict[str, Any]] = OrderedDict()

    def get(self, fname: str, force_refresh: bool = False) -> dict[str, Any]:
        if not force_refresh and fname in self._cache:
            self._cache.move_to_end(fname)
            return self._cache[fname]
        surface = self._compute(fname)
        self._cache[fname] = surface
        if len(self._cache) > SURFACE_CACHE_SIZE:
            self._cache.popitem(last=False)
        return surface

    def _compute(self, fname: str) -> dict[str, Any]:
        # Imported lazily so importing this module stays cheap and numpy
        # import costs are only paid when surfaces are actually requested.
        from hyde_bench.benchmarks import FUNCTIONS, get_bounds

        if fname not in FUNCTIONS:
            raise KeyError(f"unknown benchmark function: {fname!r}")

        lo, hi = get_bounds(fname, 2)
        func = FUNCTIONS[fname]
        xs = np.linspace(lo[0], hi[0], self._resolution)
        ys = np.linspace(lo[1], hi[1], self._resolution)
        grid_x, grid_y = np.meshgrid(xs, ys)
        zs = np.empty((self._resolution, self._resolution), dtype=float)
        for i in range(self._resolution):
            for j in range(self._resolution):
                zs[i, j] = float(func(np.array([grid_x[i, j], grid_y[i, j]])))
        return {
            "xs": xs.tolist(),
            "ys": ys.tolist(),
            "zs": zs.tolist(),
            "lo": lo.tolist(),
            "hi": hi.tolist(),
        }
