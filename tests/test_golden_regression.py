"""Golden-hash regression: catches unintended drift in the vendored algorithms.

Runs a small fixed benchmark through the CLI replication path (run_case +
summarize with main()'s kwargs) and compares the SHA-256 of the raw per-run
costs/evals against tests/golden.json.

The hash is only stable within the same numerical environment (interpreter,
numpy, BLAS). Cross-environment differences are expected and legitimate:
LAPACK kernels (CMA-ES eigh, HyGO SVD) may return slightly different floats
across BLAS builds, cascading into different trajectories. Each run's
environment is recorded in its run directory (environment.json) by the
worker. If this test fails after a BLAS/numpy upgrade, regenerate the
golden file with:

    python tests/test_golden_regression.py
"""

import hashlib
import json
import sys
from pathlib import Path

import pytest

from hyde_bench import run_benchmark as rb
from hyde_bench.hyde_bin import HyDEBin
from hyde_bench.hyde_con import HyDECon
from hyde_bench.hyde_qub import HyDEQub
from hyde_bench.hygo import HyGO
from suite.environment import environment_fingerprint

TEST_CASES = [("booth", 2), ("sphere", 25)]
N_RUNS = 2
MAX_EVALS = 1000

GOLDEN_PATH = Path(__file__).parent / "golden.json"

HYDE_KWARGS = dict(pop_size=None, max_gen=50, phase_split=0.60)
HYGO_KWARGS = dict(
    Nb=12,
    NG=50,
    Nexplor=70,
    Nexploit=30,
    Ne=1,
    ps=0.5,
    Pc=0.55,
    Pm=0.45,
    Pr=0.0,
)


def build_payload() -> dict:
    cases = [
        ("hyde_bin", HyDEBin, {**HYDE_KWARGS, "Nb": 12}),
        ("hyde_qub", HyDEQub, dict(HYDE_KWARGS)),
        ("hyde_con", HyDECon, dict(HYDE_KWARGS)),
    ]
    payload: dict = {}
    for fname, dim in TEST_CASES:
        entry = {}
        for algo_key, cls, kw in cases:
            res = rb.run_case(cls, fname, dim, dict(kw), N_RUNS, seed_base=0)
            entry[algo_key] = {
                "costs": [r["best_cost"] for r in res],
                "evals": [r["evals"] for r in res],
            }
        hkw = {**HYGO_KWARGS, "NT": 7 if dim <= 5 else 100}
        res = rb.run_case(HyGO, fname, dim, hkw, N_RUNS, seed_base=0)
        entry["hygo"] = {
            "costs": [r["best_cost"] for r in res],
            "evals": [r["evals"] for r in res],
        }
        payload[f"{fname}_{dim}D"] = entry
    return payload


def golden_config() -> dict:
    return {
        "test_cases": [list(tc) for tc in TEST_CASES],
        "n_runs": N_RUNS,
        "max_evals": MAX_EVALS,
        "seed_base": 0,
    }


def payload_hash(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@pytest.mark.skipif(not GOLDEN_PATH.exists(), reason="tests/golden.json missing")
def test_golden_regression():
    golden = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    assert golden["config"] == golden_config()
    current = build_payload()
    new_hash = payload_hash(current)
    assert new_hash == golden["hash"], (
        "Vendored algorithm behavior drifted from the golden baseline. "
        "If the change was intentional, regenerate tests/golden.json with: "
        "python tests/test_golden_regression.py"
    )


if __name__ == "__main__":
    doc = {
        "config": golden_config(),
        "environment": environment_fingerprint(),
        "hash": payload_hash(build_payload()),
    }
    GOLDEN_PATH.write_text(json.dumps(doc, indent=2), encoding="utf-8")
    print(f"golden hash: {doc['hash']}")
    print(f"wrote {GOLDEN_PATH}")
    sys.exit(0)
