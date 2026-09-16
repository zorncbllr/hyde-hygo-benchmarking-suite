"""Environment fingerprint for benchmark runs.

Captures the interpreter, library and BLAS/LAPACK versions active when a
benchmark executes. Bit-exact reproducibility of a seeded run is only
guaranteed within the same numerical environment: LAPACK kernels (CMA-ES
``eigh``, HyGO's SVD degeneracy check) can return slightly different floats
across BLAS builds, which then cascade into divergent trajectories. The
fingerprint is stored next to each run's config so cross-machine result
comparisons can be interpreted correctly.
"""

from __future__ import annotations

import platform
import sys

import numpy as np


def environment_fingerprint() -> dict:
    """Collect interpreter, library and BLAS versions as a JSON-ready dict."""
    info: dict = {
        "python": sys.version.split()[0],
        "python_implementation": platform.python_implementation(),
        "platform": platform.platform(),
        "machine": platform.machine(),
        "numpy": np.__version__,
        "blas": None,
    }
    try:
        import scipy

        info["scipy"] = scipy.__version__
    except ImportError:  # pragma: no cover - scipy is a hard dependency
        pass
    try:
        import matplotlib

        info["matplotlib"] = matplotlib.__version__
    except ImportError:  # pragma: no cover - optional for exports
        pass
    try:
        from numpy.__config__ import CONFIG  # numpy >= 2.0

        blas = CONFIG.get("Build Dependencies", {}).get("blas", {})
        blas_info = {k: blas.get(k) for k in ("name", "version") if blas.get(k)}
        if blas_info:
            info["blas"] = blas_info
    except Exception:  # noqa: BLE001 - fingerprint must never break a run
        pass
    return info
