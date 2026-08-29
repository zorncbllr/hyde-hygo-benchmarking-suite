"""Application state shared across IPC commands.

Deliberately pytauri-free: instantiated in ``suite.app.main`` and injected
into commands via ``Annotated[AppState, State()]``.
"""

from __future__ import annotations

import threading
from datetime import datetime
from typing import Callable

from pydantic import BaseModel

from .config import Settings
from .db import RunService, make_engine, make_session_factory, run_migrations
from .runner import BenchmarkWorker
from .schemas import BenchmarkConfig
from .telemetry import ThrottledEmitter


class WorkerAlreadyRunning(Exception):
    """Raised when a start is attempted while a benchmark is running."""


class NoActiveWorker(Exception):
    """Raised when cancellation is requested with no active benchmark."""


class AppState:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        settings.ensure_dirs()
        engine = make_engine(settings.db_path)
        run_migrations(engine, settings.db_path)
        self.svc = RunService(make_session_factory(engine))
        self._worker: BenchmarkWorker | None = None
        self._cancel_event: threading.Event | None = None
        self._lock = threading.Lock()
        self.surface_cache = None  # set below to avoid a circular import
        from .telemetry import SurfaceCache

        self.surface_cache = SurfaceCache()

    # -- benchmark lifecycle -----------------------------------------------------

    def start_benchmark(
        self,
        config: BenchmarkConfig,
        emit: Callable[[str, BaseModel], None],
    ) -> str:
        with self._lock:
            if self._worker is not None and self._worker.is_alive():
                raise WorkerAlreadyRunning(
                    "a benchmark is already running; cancel it first"
                )

            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            run_dir = self.settings.runs_dir / f"{stamp}_{config.n_runs}x{len(config.test_cases)}"
            run_dir.mkdir(parents=True, exist_ok=True)

            run = self.svc.create_run(
                label=config.label,
                output_dir=str(run_dir),
                n_runs=config.n_runs,
                max_evals=config.max_evals,
                alpha=config.alpha,
                seed_base=config.seed_base,
                algo_params=config.algo_params.model_dump(),
                test_cases=[tc.model_dump() for tc in config.test_cases],
            )

            cancel_event = threading.Event()
            worker = BenchmarkWorker(
                config=config,
                run_id=run.id,
                run_dir=run_dir,
                svc=self.svc,
                emit=ThrottledEmitter(emit),
                cancel_event=cancel_event,
            )
            self._worker = worker
            self._cancel_event = cancel_event
        worker.start()
        return run.id

    def cancel_benchmark(self) -> None:
        with self._lock:
            if self._cancel_event is None or (
                self._worker is not None and not self._worker.is_alive()
            ):
                raise NoActiveWorker("no benchmark is currently running")
            self._cancel_event.set()

    @property
    def is_running(self) -> bool:
        return self._worker is not None and self._worker.is_alive()

    def active_run_snapshot(self) -> dict:
        """Progress snapshot of the active worker, or inactive marker.

        The worker object outlives thread completion, so a finished worker
        still reports its final counters (useful for late UI mounts).
        """
        with self._lock:
            if self._worker is None:
                return {"active": False}
            snap = self._worker.snapshot()
            thread_alive = self._worker.is_alive()
            snap["status"] = "running" if thread_alive else snap.get("status", "running")
            snap["active"] = thread_alive
            return snap
