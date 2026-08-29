"""Pydantic schemas for IPC commands and event payloads.

Imported by both the pytauri command layer and the business logic, and kept
free of pytauri imports so it can be unit-tested standalone.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

ALGO_KEYS = ("hyde_bin", "hyde_qub", "hyde_con", "hygo")


# -- Health ---------------------------------------------------------------------


class PingRequest(BaseModel):
    payload: str = "ping"


class PongResponse(BaseModel):
    message: str


# -- Request bodies -----------------------------------------------------------


class TestCase(BaseModel):
    fname: str = Field(min_length=1, max_length=64)
    dim: int = Field(ge=2, le=100)


class HydeParams(BaseModel):
    max_gen: int = Field(default=50, ge=1, le=1000)
    phase_split: float = Field(default=0.60, ge=0.1, le=0.9)
    Nb: int = Field(default=12, ge=1, le=64)


class HygoParams(BaseModel):
    Nb: int = Field(default=12, ge=1, le=64)
    NG: int = Field(default=50, ge=1, le=1000)
    Nexplor: int = Field(default=70, ge=1, le=10_000)
    Nexploit: int = Field(default=30, ge=0, le=10_000)
    Ne: int = Field(default=1, ge=0, le=100)
    ps: float = Field(default=0.5, ge=0.0, le=1.0)
    Pc: float = Field(default=0.55, ge=0.0, le=1.0)
    Pm: float = Field(default=0.45, ge=0.0, le=1.0)
    Pr: float = Field(default=0.0, ge=0.0, le=1.0)


class AlgoParams(BaseModel):
    hyde: HydeParams = HydeParams()
    hygo: HygoParams = HygoParams()


class BenchmarkConfig(BaseModel):
    label: str = Field(min_length=1, max_length=256)
    test_cases: list[TestCase] = Field(min_length=1, max_length=200)
    n_runs: int = Field(default=50, ge=1, le=500)
    max_evals: int = Field(default=50_000, ge=1000, le=10_000_000)
    alpha: float = Field(default=0.05, ge=0.001, le=0.2)
    seed_base: int = Field(default=0, ge=0)
    algo_params: AlgoParams = AlgoParams()

    @field_validator("test_cases")
    @classmethod
    def dedupe(cls, v: list[TestCase]) -> list[TestCase]:
        seen: set[tuple[str, int]] = set()
        out: list[TestCase] = []
        for tc in v:
            key = (tc.fname, tc.dim)
            if key not in seen:
                seen.add(key)
                out.append(tc)
        return out


class StartBenchmarkRequest(BaseModel):
    config: BenchmarkConfig


class SurfaceRequest(BaseModel):
    fname: str = Field(min_length=1, max_length=64)


class ListRunsRequest(BaseModel):
    status: str | None = None
    tag: str | None = None
    search: str | None = None
    sort: Literal["created_at", "label", "duration_s", "status", "n_runs"] = (
        "created_at"
    )
    order: Literal["asc", "desc"] = "desc"
    page: int = Field(default=1, ge=1)
    per_page: int = Field(default=20, ge=1, le=100)


class RunIdRequest(BaseModel):
    run_id: str = Field(min_length=1)


class GetPayloadRequest(BaseModel):
    run_id: str = Field(min_length=1)
    payload_path: str = Field(min_length=1)


class GetScenarioPayloadsRequest(BaseModel):
    run_id: str = Field(min_length=1)
    scenario_key: str = Field(min_length=1, max_length=80)


class UpdateRunRequest(BaseModel):
    run_id: str = Field(min_length=1)
    label: str | None = Field(default=None, min_length=1, max_length=256)
    notes: str | None = Field(default=None, max_length=10_000)


class SetTagsRequest(BaseModel):
    run_id: str = Field(min_length=1)
    tags: list[str] = Field(max_length=64)


class BatchTagRequest(BaseModel):
    run_ids: list[str] = Field(min_length=1)
    add: list[str] = Field(default_factory=list)
    remove: list[str] = Field(default_factory=list)


class DeleteRunsRequest(BaseModel):
    run_ids: list[str] = Field(min_length=1)
    with_artifacts: bool = False


class DuplicateRunRequest(BaseModel):
    run_id: str = Field(min_length=1)


class CompareRunsRequest(BaseModel):
    run_ids: list[str] = Field(min_length=2, max_length=4)


class RunExportsRequest(BaseModel):
    run_id: str = Field(min_length=1)
    groups: list[str] = Field(
        default_factory=lambda: ["csv", "charts", "docx", "json"]
    )


class PathExistsRequest(BaseModel):
    path: str = Field(min_length=1)


class ActiveRunResponse(BaseModel):
    active: bool
    run_id: str | None = None
    total_runs: int = 0
    completed_runs: int = 0
    scenarios: int = 0
    scenarios_done: int = 0
    current_fname: str | None = None
    current_dim: int | None = None
    current_algo: str | None = None


# -- Responses ----------------------------------------------------------------


class OkResponse(BaseModel):
    ok: bool = True


class StartBenchmarkResponse(BaseModel):
    run_id: str


class SurfaceResponse(BaseModel):
    xs: list[float]
    ys: list[float]
    zs: list[list[float]]
    lo: list[float]
    hi: list[float]


class RunRow(BaseModel):
    id: str
    label: str
    status: str
    created_at: str
    duration_s: float | None
    output_dir: str
    n_runs: int
    max_evals: int
    alpha: float
    scenarios: int
    tags: list[str]


class ListRunsResponse(BaseModel):
    items: list[RunRow]
    total: int
    page: int
    per_page: int


class ScenarioResultRow(BaseModel):
    fname: str
    dim: int
    algo_key: str
    payloads_path: str
    converged_all: bool
    # metric columns (mirror of the DB row); derived metrics are nullable
    # because they are undefined for single-run / degenerate experiments
    conv_pct: float
    mean_best: float | None
    median_best: float | None
    std_best: float | None
    min_best: float | None
    max_best: float | None
    iqr_best: float | None
    cv: float | None
    mean_obj_error: float | None
    std_obj_error: float | None
    mean_conv_gen: float | None
    mean_auc: float | None
    std_auc: float | None
    mean_evals: float | None
    mean_wall_ms: float | None
    median_wall_ms: float | None
    evals_per_ms: float | None


class RunDetailResponse(BaseModel):
    id: str
    created_at: str
    updated_at: str
    label: str
    notes: str | None
    status: str
    duration_s: float | None
    output_dir: str
    seed_base: int
    n_runs: int
    max_evals: int
    alpha: float
    algo_params: dict | None
    test_cases: list[TestCase]
    scenario_results: list[ScenarioResultRow]
    tags: list[str]


class DeleteRunsResponse(BaseModel):
    deleted: list[str]
    artifact_dirs: list[str]


class CompareRunsResponse(BaseModel):
    data: dict


# -- Event payloads -----------------------------------------------------------


class StartedEvent(BaseModel):
    run_id: str
    total_runs: int
    scenarios: int


class TelemetryEvent(BaseModel):
    run_id: str
    fname: str
    dim: int
    algo_key: str
    run_idx: int
    n_runs: int
    phase: str
    gen: int | None
    eval_count: int
    best_cost: float
    gen_best_tail: list[float]
    positions: list[list[float]] | None = None
    best_pos: list[float] | None = None


class RunDoneEvent(BaseModel):
    run_id: str
    fname: str
    dim: int
    algo_key: str
    run_idx: int
    n_runs: int
    best_cost: float
    wall_ms: float
    conv_gen: int | None
    completed: int
    total: int


class ScenarioDoneEvent(BaseModel):
    run_id: str
    key: str
    elapsed_s: float
    best_algo: str
    medians: dict[str, float]


class CompleteEvent(BaseModel):
    run_id: str
    duration_s: float
    scenarios: int


class CancelledEvent(BaseModel):
    run_id: str


class ErrorEvent(BaseModel):
    run_id: str
    error: str
