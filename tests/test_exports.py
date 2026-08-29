"""Integration tests for the export facade (reference-function parity)."""

import threading
from pathlib import Path

import pytest

from suite.db import RunService, make_engine, make_session_factory, run_migrations
from suite.db.payloads import read_payload
from suite.exports import run_exports_sync
from suite.runner import BenchmarkWorker
from suite.schemas import BenchmarkConfig


@pytest.fixture
def completed_run(tmp_path: Path):
    """Runs a mini benchmark end-to-end and returns (svc, run_id, run_dir)."""
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


def test_export_csv_group(completed_run):
    svc, run_id, run_dir = completed_run
    artifacts = run_exports_sync(run_id, svc, ["csv"])
    csv_dir = Path(artifacts["csv"][0])
    assert (csv_dir / "benchmark_summary.csv").exists()
    assert (csv_dir / "benchmark_raw_costs.csv").exists()
    assert (csv_dir / "qa_friedman_objective_error.csv").exists()
    assert (csv_dir / "qe_scaling_analysis.csv").exists()
    # per-run CSVs reconstructed from payloads
    per_run = list(csv_dir.glob("**/run_*.csv"))
    assert len(per_run) == 8  # 2 runs x 4 algos


def test_export_charts_group(completed_run):
    svc, run_id, run_dir = completed_run
    artifacts = run_exports_sync(run_id, svc, ["charts"])
    chart_dir = Path(artifacts["charts"][0])
    pngs = list(chart_dir.glob("*.png"))
    assert len(pngs) > 0


def test_export_docx_group(completed_run):
    svc, run_id, run_dir = completed_run
    artifacts = run_exports_sync(run_id, svc, ["docx"])
    report = Path(artifacts["docx"][0])
    assert report.name == "benchmark_report.docx"
    assert report.stat().st_size > 10_000


def test_export_json_group(completed_run):
    svc, run_id, run_dir = completed_run
    artifacts = run_exports_sync(run_id, svc, ["json"])
    assert (Path(artifacts["json"][0])).exists()


def test_module_constants_restored(completed_run):
    """The reference module's directory constants are restored after export."""
    import hyde_bench.run_benchmark as rb

    original_csv, original_chart = rb.CSV_DIR, rb.CHART_DIR
    svc, run_id, _ = completed_run
    run_exports_sync(run_id, svc, ["csv"])
    assert rb.CSV_DIR == original_csv
    assert rb.CHART_DIR == original_chart


def test_payload_shape_matches_frontend_schema(completed_run):
    """The persisted payload must contain every field the frontend zod
    scenarioPayloadSchema requires (drift broke charts before)."""
    from suite.schemas import RunDetailResponse

    svc, run_id, run_dir = completed_run
    detail = RunDetailResponse(**svc.get_run_detail(run_id))
    required = {
        "raw_costs",
        "raw_wall_ms",
        "raw_evals",
        "raw_aucs",
        "raw_obj_errors",
        "mean_curve",
        "curves",
        "conv_binary",
        "global_opt",
    }
    for sr in detail.scenario_results:
        payload = read_payload(Path(sr.payloads_path))
        missing = required - set(payload.keys())
        assert not missing, f"{sr.algo_key} payload missing: {missing}"
        assert isinstance(payload.get("replay_histories", []), list)


def test_export_missing_results_file(tmp_path: Path):
    db_path = tmp_path / "suite.db"
    engine = make_engine(db_path)
    run_migrations(engine, db_path)
    svc = RunService(make_session_factory(engine))
    run_dir = tmp_path / "runs" / "empty"
    run_dir.mkdir(parents=True)
    run = svc.create_run(
        label="empty",
        output_dir=str(run_dir),
        n_runs=1,
        max_evals=1000,
        alpha=0.05,
        seed_base=0,
        algo_params={},
        test_cases=[{"fname": "booth", "dim": 2}],
    )
    svc.mark_running(run.id)
    svc.mark_completed(run.id, 1.0)
    with pytest.raises(FileNotFoundError):
        run_exports_sync(run.id, svc, ["csv"])
    engine.dispose()
