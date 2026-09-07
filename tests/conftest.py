"""Shared fixtures: file-backed SQLite database with migrations applied."""

import threading
from pathlib import Path

import pytest

from suite.db import RunService, make_engine, make_session_factory, run_migrations


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "suite.db"


@pytest.fixture
def session_factory(db_path: Path):
    engine = make_engine(db_path)
    run_migrations(engine, db_path)
    yield make_session_factory(engine)
    engine.dispose()


@pytest.fixture
def svc(session_factory) -> RunService:
    return RunService(session_factory)


@pytest.fixture
def run_kwargs(tmp_path: Path) -> dict:
    return {
        "label": "smoke run",
        "output_dir": str(tmp_path / "runs" / "r1"),
        "n_runs": 50,
        "max_evals": 50_000,
        "alpha": 0.05,
        "seed_base": 0,
        "algo_params": {"hyde": {"max_gen": 50}, "hygo": {"NG": 50}},
        "test_cases": [{"fname": "booth", "dim": 2}, {"fname": "sphere", "dim": 25}],
    }


@pytest.fixture
def completed_run(tmp_path: Path):
    """Runs a mini benchmark end-to-end and returns (svc, run_id, run_dir)."""
    from suite.runner import BenchmarkWorker
    from suite.schemas import BenchmarkConfig

    db_path = tmp_path / "suite.db"
    engine = make_engine(db_path)
    run_migrations(engine, db_path)
    svc = RunService(make_session_factory(engine))

    config = BenchmarkConfig(
        label="export test",
        test_cases=[{"fname": "booth", "dim": 2}],
        n_runs=2,
        max_evals=1000,
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
    worker.join(timeout=120)
    assert svc.get_run(run.id).status == "completed"
    yield svc, run.id, run_dir
    engine.dispose()
