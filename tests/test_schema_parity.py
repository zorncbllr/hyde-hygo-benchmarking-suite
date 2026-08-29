"""Schema parity tests: pydantic response models vs frontend zod schemas.

These tests assert that every field the frontend requires (ui/src/lib/schemas.ts)
is present on the corresponding pydantic response model. Serialization drops
fields missing from the pydantic model, which the frontend then rejects -
this exact drift broke the Results page (RunRow.output_dir) and nullable
metrics before.
"""

import json

from suite.schemas import (
    ActiveRunResponse,
    CompleteEvent,
    DeleteRunsResponse,
    OkResponse,
    RunDetailResponse,
    RunDoneEvent,
    ScenarioDoneEvent,
    ScenarioResultRow,
    StartedEvent,
    SurfaceResponse,
    TelemetryEvent,
)


def _fields(model) -> set[str]:
    return set(model.model_json_schema()["properties"].keys())


def test_run_row_parity_with_frontend():
    from suite.schemas import RunRow

    expected = {
        "id",
        "label",
        "status",
        "created_at",
        "duration_s",
        "output_dir",
        "n_runs",
        "max_evals",
        "alpha",
        "scenarios",
        "tags",
    }
    fields = _fields(RunRow)
    missing = expected - fields
    assert not missing, f"RunRow is missing fields the frontend requires: {missing}"


def test_run_detail_parity_with_frontend():
    expected = {
        "id",
        "created_at",
        "updated_at",
        "label",
        "notes",
        "status",
        "duration_s",
        "output_dir",
        "seed_base",
        "n_runs",
        "max_evals",
        "alpha",
        "algo_params",
        "test_cases",
        "scenario_results",
        "tags",
    }
    fields = _fields(RunDetailResponse)
    missing = expected - fields
    assert not missing, f"RunDetailResponse missing fields: {missing}"


def test_scenario_result_row_parity_with_frontend():
    expected = {
        "fname",
        "dim",
        "algo_key",
        "payloads_path",
        "converged_all",
        "conv_pct",
        "mean_best",
        "median_best",
        "std_best",
        "min_best",
        "max_best",
        "iqr_best",
        "cv",
        "mean_obj_error",
        "std_obj_error",
        "mean_conv_gen",
        "mean_auc",
        "std_auc",
        "mean_evals",
        "mean_wall_ms",
        "median_wall_ms",
        "evals_per_ms",
    }
    fields = _fields(ScenarioResultRow)
    missing = expected - fields
    assert not missing, f"ScenarioResultRow missing fields: {missing}"


def test_event_payload_parity_with_frontend():
    cases = {
        StartedEvent: {
            "run_id",
            "total_runs",
            "scenarios",
        },
        TelemetryEvent: {
            "run_id",
            "fname",
            "dim",
            "algo_key",
            "run_idx",
            "n_runs",
            "phase",
            "gen",
            "eval_count",
            "best_cost",
            "gen_best_tail",
            "positions",
            "best_pos",
        },
        RunDoneEvent: {
            "run_id",
            "fname",
            "dim",
            "algo_key",
            "run_idx",
            "n_runs",
            "best_cost",
            "wall_ms",
            "conv_gen",
            "completed",
            "total",
        },
        ScenarioDoneEvent: {
            "run_id",
            "key",
            "elapsed_s",
            "best_algo",
            "medians",
        },
        CompleteEvent: {"run_id", "duration_s", "scenarios"},
    }
    for model, expected in cases.items():
        missing = expected - _fields(model)
        assert not missing, f"{model.__name__} missing fields: {missing}"


def test_misc_response_parity_with_frontend():
    cases = {
        SurfaceResponse: {"xs", "ys", "zs", "lo", "hi"},
        DeleteRunsResponse: {"deleted", "artifact_dirs"},
        OkResponse: {"ok"},
        ActiveRunResponse: {
            "active",
            "run_id",
            "total_runs",
            "completed_runs",
            "scenarios",
            "scenarios_done",
            "current_fname",
            "current_dim",
            "current_algo",
        },
    }
    for model, expected in cases.items():
        missing = expected - _fields(model)
        assert not missing, f"{model.__name__} missing fields: {missing}"


def test_nullable_metrics_serialize_as_null():
    """NULL metrics must survive serialization (JSON null, not dropped)."""
    row = ScenarioResultRow(
        fname="ackley",
        dim=2,
        algo_key="hyde_bin",
        payloads_path="/tmp/x.json.zst",
        converged_all=True,
        conv_pct=100.0,
        mean_best=0.0,
        median_best=0.0,
        std_best=None,
        min_best=0.0,
        max_best=0.0,
        iqr_best=0.0,
        cv=None,
        mean_obj_error=0.0,
        std_obj_error=None,
        mean_conv_gen=None,
        mean_auc=-1.0,
        std_auc=None,
        mean_evals=1000.0,
        mean_wall_ms=10.0,
        median_wall_ms=10.0,
        evals_per_ms=100.0,
    )
    data = json.loads(row.model_dump_json())
    assert data["std_best"] is None
    assert data["cv"] is None
