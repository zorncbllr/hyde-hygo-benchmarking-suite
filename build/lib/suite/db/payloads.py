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


def resolve_scenario_payloads(
    run_dir: Path,
    scenario_results: list[dict],
    scenario_key: str,
) -> dict[str, Any]:
    """Batch-read the payloads of every algorithm for one scenario key
    (``<fname>_<dim>D``).

    Paths are resolved against ``run_dir`` and rejected when they escape it,
    mirroring the single-payload command's traversal protection.
    """
    run_dir = Path(run_dir).resolve()
    payloads: dict[str, Any] = {}
    for sr in scenario_results:
        if f"{sr['fname']}_{sr['dim']}D" != scenario_key:
            continue
        path = (run_dir / sr["payloads_path"]).resolve()
        if not path.is_relative_to(run_dir) or path.suffix != ".zst":
            raise ValueError("invalid payload path")
        if not path.exists():
            raise FileNotFoundError(f"payload file not found: {path.name}")
        payloads[sr["algo_key"]] = read_payload(path)
    if not payloads:
        raise ValueError(f"unknown scenario: {scenario_key}")
    return payloads
