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


# Per-eval cost histories and per-generation population snapshots dominate a
# payload (~15MB of a ~17MB file for a 50-run 2D scenario) but are never
# rendered by the results charts: cost_histories is not part of the UI
# schema at all, and replay_histories is fetched per algorithm on demand
# through ``get_payload`` when the 3D replay tab opens. Excluding them keeps
# the mount-time batch read in the tens of KB instead of ~60MB over IPC.
SLIM_EXCLUDED_KEYS = frozenset({"cost_histories", "replay_histories"})


def resolve_scenario_payloads(
    run_dir: Path,
    scenario_results: list[dict],
    scenario_key: str,
    *,
    slim: bool = False,
) -> dict[str, Any]:
    """Batch-read the payloads of every algorithm for one scenario key
    (``<fname>_<dim>D``).

    Paths are resolved against ``run_dir`` and rejected when they escape it,
    mirroring the single-payload command's traversal protection.

    With ``slim=True`` the oversized ``cost_histories``/``replay_histories``
    fields are excluded (see :data:`SLIM_EXCLUDED_KEYS`); use it for
    interactive reads, keep the default for anything that needs the full
    payload.
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
        data = read_payload(path)
        if slim:
            data = {k: v for k, v in data.items() if k not in SLIM_EXCLUDED_KEYS}
        payloads[sr["algo_key"]] = data
    if not payloads:
        raise ValueError(f"unknown scenario: {scenario_key}")
    return payloads
