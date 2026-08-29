"""Zstd-compressed JSON payload storage for heavy per-scenario arrays.

Raw costs, wall times, evaluation counts, AUCs, mean curves and per-run
conv binary vectors are written once per (scenario, algorithm) result and
read back for charts and comparisons. Keeping them out of the database keeps
the relational layer small and queryable while remaining fully offline.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import zstandard as zstd


def write_payload(path: Path, data: Any) -> None:
    """Atomically write ``data`` as zstd-compressed JSON to ``path``."""
    path.parent.mkdir(parents=True, exist_ok=True)
    blob = zstd.ZstdCompressor(level=7).compress(
        json.dumps(data, separators=(",", ":")).encode("utf-8")
    )
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(blob)
    tmp.replace(path)


def read_payload(path: Path) -> Any:
    """Read a zstd-compressed JSON payload written by :func:`write_payload`."""
    blob = path.read_bytes()
    return json.loads(zstd.ZstdDecompressor().decompress(blob))
