"""Final regression: app worker output == direct CLI-loop output.

Runs the same mini benchmark twice with identical seeds:
1. through the suite's BenchmarkWorker (the app code path),
2. through a direct replication of ``run_benchmark.main()``'s loop
   (the CLI code path, using run_case + summarize),
then asserts the resulting benchmark_results.json documents are identical.
"""

import json
import threading
from pathlib import Path

import pytest

from hyde_bench import run_benchmark as rb
from hyde_bench.benchmarks import FUNCTIONS
from hyde_bench.hyde_bin import HyDEBin
from hyde_bench.hyde_con import HyDECon
from hyde_bench.hyde_qub import HyDEQub
from hyde_bench.hygo import HyGO
from suite.db import RunService, make_engine, make_session_factory, run_migrations
from suite.runner import BenchmarkWorker
from suite.schemas import BenchmarkConfig

TEST_CASES = [("booth", 2), ("sphere", 25)]
N_RUNS = 2
MAX_EVALS = 1000


def cli_loop_results(tmp_path: Path) -> dict:
    """Direct CLI-path replication (run_case + summarize, main() kwargs)."""
    rb.MAX_EVALS = MAX_EVALS
    hyde_kwargs = dict(pop_size=None, max_gen=50, phase_split=0.60)
    hygo_kwargs = dict(
        Nb=12, NG=50, Nexplor=70, Nexploit=30,
        Ne=1, ps=0.5, Pc=0.55, Pm=0.45, Pr=0.0,
    )
    algo_kwargs = {
        "hyde_bin": {**hyde_kwargs, "Nb": 12},
        "hyde_qub": hyde_kwargs,
        "hyde_con": hyde_kwargs,
        "hygo": hygo_kwargs,
    }

    all_results = {}
    for fname, dim in TEST_CASES:
        entry = {}
        cases = [
            ("hyde_bin", HyDEBin, algo_kwargs["hyde_bin"]),
            ("hyde_qub", HyDEQub, algo_kwargs["hyde_qub"]),
            ("hyde_con", HyDECon, algo_kwargs["hyde_con"]),
        ]
        for algo_key, cls, kw in cases:
            res = rb.run_case(cls, fname, dim, dict(kw), N_RUNS, seed_base=0)
            entry[algo_key] = rb.summarize(res, fname, dim)
        hkw = {**hygo_kwargs, "NT": 7 if dim <= 5 else 100}
        res = rb.run_case(HyGO, fname, dim, hkw, N_RUNS, seed_base=0)
        entry["hygo"] = rb.summarize(res, fname, dim)
        all_results[f"{fname}_{dim}D"] = entry
    return all_results


@pytest.fixture
def worker_results(tmp_path: Path) -> dict:
    db_path = tmp_path / "suite.db"
    engine = make_engine(db_path)
    run_migrations(engine, db_path)
    svc = RunService(make_session_factory(engine))

    config = BenchmarkConfig(
        label="parity",
        test_cases=[{"fname": f, "dim": d} for f, d in TEST_CASES],
        n_runs=N_RUNS,
        max_evals=MAX_EVALS,
        alpha=0.05,
        seed_base=0,
    )
    run_dir = tmp_path / "runs" / "r1"
    run_dir.mkdir(parents=True)
    run = svc.create_run(
        label=config.label,
        output_dir=str(run_dir),
        n_runs=config.n_runs,
        max_evals=config.max_evals,
        alpha=config.alpha,
        seed_base=config.seed_base,
        algo_params=config.algo_params.model_dump(),
        test_cases=[tc.model_dump() for tc in config.test_cases],
    )
    worker = BenchmarkWorker(
        config=config,
        run_id=run.id,
        run_dir=run_dir,
        svc=svc,
        emit=lambda *_: None,
        cancel_event=threading.Event(),
    )
    worker.start()
    worker.join(timeout=300)
    assert svc.get_run(run.id).status == "completed"
    yield json.loads(
        (run_dir / "benchmark_results.json").read_text(encoding="utf-8")
    )
    engine.dispose()


def _strip_wall(d: dict) -> dict:
    """Remove wall-time fields (machine-dependent, not seed-dependent)."""
    wall_keys = {"mean_wall_ms", "std_wall_ms", "median_wall_ms", "raw_wall_ms",
                 "evals_per_ms"}
    for entry in d.values():
        for summary in entry.values():
            for k in wall_keys:
                summary.pop(k, None)
    return d


def test_worker_matches_cli_loop(worker_results):
    _ = FUNCTIONS  # ensure benchmark module loaded
    cli = _strip_wall(cli_loop_results(Path("/tmp")))
    app = _strip_wall(worker_results)
    assert json.dumps(cli, sort_keys=True) == json.dumps(app, sort_keys=True)
