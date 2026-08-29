"""Shared fixtures: file-backed SQLite database with migrations applied."""

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
