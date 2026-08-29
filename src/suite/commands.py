"""IPC command handlers (pytauri-dependent, thin layer over services).

Every command validates its body via pydantic schemas, delegates to the
pytauri-free business layer, and maps domain errors to InvokeException so
the frontend receives clean error messages. Commands are rate-limited with
per-command minimum intervals.
"""

from __future__ import annotations

import json
from typing import Annotated, Any

from pydantic import BaseModel
from pytauri import AppHandle, Commands, Emitter, State
from pytauri.ipc import InvokeException

from .db import RunServiceError
from .db.payloads import read_payload
from .ratelimit import RateLimited, rate_limit
from .schemas import (
    ActiveRunResponse,
    BatchTagRequest,
    BenchmarkConfig,
    CompareRunsRequest,
    CompareRunsResponse,
    DeleteRunsRequest,
    DeleteRunsResponse,
    DuplicateRunRequest,
    GetPayloadRequest,
    ListRunsRequest,
    ListRunsResponse,
    OkResponse,
    PathExistsRequest,
    PingRequest,
    PongResponse,
    RunDetailResponse,
    RunExportsRequest,
    RunIdRequest,
    SetTagsRequest,
    StartBenchmarkRequest,
    StartBenchmarkResponse,
    SurfaceRequest,
    SurfaceResponse,
    UpdateRunRequest,
)
from .state import AppState, NoActiveWorker, WorkerAlreadyRunning

commands: Commands = Commands()


def _rl(min_interval_s: float):
    """Rate limiter that raises pytauri's InvokeException on throttle."""

    def factory(exc: RateLimited) -> Exception:
        return InvokeException(str(exc))

    return rate_limit(min_interval_s, error_factory=factory)


def _domain_error(exc: Exception) -> InvokeException:
    return InvokeException(str(exc))


def _emit(app_handle: AppHandle, event: str, payload: BaseModel) -> None:
    Emitter.emit(app_handle, event, payload)


# -- exports --------------------------------------------------------------------


@commands.command()
@_rl(1.0)
async def run_exports(
    body: RunExportsRequest,
    state: Annotated[AppState, State()],
    app_handle: AppHandle,
) -> OkResponse:
    """Regenerate benchmark artifacts through the reference export functions."""
    from .exports import ExportRequest, ExportRunner

    req = ExportRequest(run_id=body.run_id, groups=body.groups)
    try:
        groups = req.validated_groups
    except ValueError as exc:
        raise _domain_error(exc) from exc
    try:
        state.svc.get_run_detail(req.run_id)
    except KeyError as exc:
        raise _domain_error(exc) from exc

    runner = ExportRunner(
        run_id=req.run_id,
        svc=state.svc,
        emit=lambda event, payload: _emit(app_handle, event, payload),
    )
    runner.start(groups)
    return OkResponse()


# -- health -------------------------------------------------------------------


@commands.command()
async def ping(body: PingRequest) -> PongResponse:
    """Health-check command used to verify the IPC bridge end-to-end."""
    return PongResponse(message=f"pong: {body.payload}")


# -- benchmark control --------------------------------------------------------


@commands.command()
@_rl(0.5)
async def start_benchmark(
    body: StartBenchmarkRequest,
    state: Annotated[AppState, State()],
    app_handle: AppHandle,
) -> StartBenchmarkResponse:
    config: BenchmarkConfig = body.config
    # Cross-validate scenario selection against the benchmark library.
    from hyde_bench.benchmarks import FUNCTIONS

    for tc in config.test_cases:
        if tc.fname not in FUNCTIONS:
            raise InvokeException(f"unknown benchmark function: {tc.fname!r}")

    try:
        run_id = state.start_benchmark(
            config, emit=lambda event, payload: _emit(app_handle, event, payload)
        )
    except WorkerAlreadyRunning as exc:
        raise _domain_error(exc) from exc
    except RunServiceError as exc:
        raise _domain_error(exc) from exc
    return StartBenchmarkResponse(run_id=run_id)


@commands.command()
@_rl(0.2)
async def cancel_benchmark(
    state: Annotated[AppState, State()],
) -> OkResponse:
    try:
        state.cancel_benchmark()
    except NoActiveWorker as exc:
        raise _domain_error(exc) from exc
    return OkResponse()


@commands.command()
@rate_limit(0.1)
async def get_active_run(
    state: Annotated[AppState, State()],
) -> ActiveRunResponse:
    """Progress sync for late UI mounts (events emitted before subscription
    are lost; this returns the worker's authoritative counters)."""
    return ActiveRunResponse(**state.active_run_snapshot())


# -- 3D surface ---------------------------------------------------------------


@commands.command()
@_rl(0.1)
async def get_surface(
    body: SurfaceRequest,
    state: Annotated[AppState, State()],
) -> SurfaceResponse:
    try:
        surface = state.surface_cache.get(body.fname)
    except KeyError as exc:
        raise _domain_error(exc) from exc
    return SurfaceResponse(**surface)


# -- run history --------------------------------------------------------------


@commands.command()
@_rl(0.05)
async def list_runs(
    body: ListRunsRequest,
    state: Annotated[AppState, State()],
) -> ListRunsResponse:
    try:
        return ListRunsResponse(**state.svc.list_runs(**body.model_dump()))
    except RunServiceError as exc:
        raise _domain_error(exc) from exc


@commands.command()
@_rl(0.05)
async def get_run_detail(
    body: RunIdRequest,
    state: Annotated[AppState, State()],
) -> RunDetailResponse:
    try:
        return RunDetailResponse(**state.svc.get_run_detail(body.run_id))
    except KeyError as exc:
        raise _domain_error(exc) from exc


@commands.command()
@_rl(0.05)
async def update_run(
    body: UpdateRunRequest,
    state: Annotated[AppState, State()],
) -> OkResponse:
    try:
        state.svc.update_run(body.run_id, label=body.label, notes=body.notes)
    except (KeyError, RunServiceError) as exc:
        raise _domain_error(exc) from exc
    return OkResponse()


@commands.command()
@_rl(0.05)
async def set_tags(
    body: SetTagsRequest,
    state: Annotated[AppState, State()],
) -> OkResponse:
    try:
        state.svc.set_tags(body.run_id, body.tags)
    except (KeyError, RunServiceError) as exc:
        raise _domain_error(exc) from exc
    return OkResponse()


@commands.command()
@_rl(0.1)
async def tag_runs(
    body: BatchTagRequest,
    state: Annotated[AppState, State()],
) -> OkResponse:
    try:
        state.svc.tag_runs(body.run_ids, add=body.add, remove=body.remove)
    except (KeyError, RunServiceError) as exc:
        raise _domain_error(exc) from exc
    return OkResponse()


@commands.command()
@_rl(0.1)
async def delete_runs(
    body: DeleteRunsRequest,
    state: Annotated[AppState, State()],
) -> DeleteRunsResponse:
    import shutil

    try:
        output_dirs = state.svc.delete_runs(body.run_ids)
    except (KeyError, RunServiceError) as exc:
        raise _domain_error(exc) from exc
    if body.with_artifacts:
        for d in output_dirs:
            shutil.rmtree(d, ignore_errors=True)
    return DeleteRunsResponse(
        deleted=body.run_ids,
        artifact_dirs=output_dirs if body.with_artifacts else [],
    )


@commands.command()
@_rl(0.2)
async def duplicate_run(
    body: DuplicateRunRequest,
    state: Annotated[AppState, State()],
) -> OkResponse:
    import uuid
    from datetime import UTC, datetime

    try:
        new_dir = str(
            state.settings.runs_dir
            / f"draft_{datetime.now(UTC).strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
        )
        state.svc.duplicate_run(body.run_id, new_output_dir=new_dir)
    except KeyError as exc:
        raise _domain_error(exc) from exc
    return OkResponse()


@commands.command()
@_rl(0.1)
async def compare_runs(
    body: CompareRunsRequest,
    state: Annotated[AppState, State()],
) -> CompareRunsResponse:
    try:
        return CompareRunsResponse(data=state.svc.compare_runs(body.run_ids))
    except (KeyError, RunServiceError) as exc:
        raise _domain_error(exc) from exc


# -- results / payloads ---------------------------------------------------------


@commands.command()
@_rl(0.1)
async def load_results(
    body: RunIdRequest,
    state: Annotated[AppState, State()],
) -> dict[str, Any]:
    """Return the incremental benchmark_results.json of a run."""
    from pathlib import Path

    try:
        detail = state.svc.get_run_detail(body.run_id)
    except KeyError as exc:
        raise _domain_error(exc) from exc
    path = Path(detail["output_dir"]) / "benchmark_results.json"
    if not path.exists():
        raise InvokeException(
            "benchmark_results.json not found; the run may not be finished"
        )
    return json.loads(path.read_text(encoding="utf-8"))


@commands.command()
@_rl(0.1)
async def get_payload(
    body: GetPayloadRequest,
    state: Annotated[AppState, State()],
) -> dict[str, Any]:
    """Return the zstd payload for one (scenario, algo) of a run.

    The payload path is resolved against the run directory recorded in the
    database; path traversal outside the run dir is rejected.
    """
    from pathlib import Path

    try:
        detail = state.svc.get_run_detail(body.run_id)
    except KeyError as exc:
        raise _domain_error(exc) from exc
    run_dir = Path(detail["output_dir"]).resolve()
    path = (run_dir / body.payload_path).resolve()
    if not path.is_relative_to(run_dir) or path.suffix != ".zst":
        raise InvokeException("invalid payload path")
    if not path.exists():
        raise InvokeException("payload file not found")
    return read_payload(path)


@commands.command()
@_rl(0.1)
async def get_analysis(
    body: RunIdRequest,
    state: Annotated[AppState, State()],
) -> dict[str, Any]:
    """Return analysis_summary.json (written by run_exports) for a run."""
    from pathlib import Path

    try:
        detail = state.svc.get_run_detail(body.run_id)
    except KeyError as exc:
        raise _domain_error(exc) from exc
    path = Path(detail["output_dir"]) / "analysis_summary.json"
    if not path.exists():
        raise InvokeException(
            "analysis_summary.json not found; run the exports first"
        )
    return json.loads(path.read_text(encoding="utf-8"))


@commands.command()
@_rl(0.1)
async def path_exists(
    body: PathExistsRequest,
) -> OkResponse:
    """Read-only existence check used by the UI before opening file managers."""
    from pathlib import Path

    return OkResponse(ok=Path(body.path).exists())


@commands.command()
@_rl(0.5)
async def worker_status(
    state: Annotated[AppState, State()],
) -> OkResponse:
    return OkResponse(ok=state.is_running)
