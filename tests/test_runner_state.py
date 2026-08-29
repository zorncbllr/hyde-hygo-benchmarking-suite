"""Tests for the benchmark runner, app state and telemetry."""

import threading
from pathlib import Path

import pytest
from pydantic import BaseModel

from suite.config import Settings
from suite.db import RunService, make_engine, make_session_factory, run_migrations
from suite.runner import BenchmarkWorker, default_algo_kwargs
from suite.schemas import (
    AlgoParams,
    BenchmarkConfig,
    CancelledEvent,
    RunDoneEvent,
    StartedEvent,
    TelemetryEvent,
)
from suite.state import AppState, NoActiveWorker, WorkerAlreadyRunning
from suite.telemetry import SurfaceCache, ThrottledEmitter


def make_config(**overrides) -> BenchmarkConfig:
    base = dict(
        label="test run",
        test_cases=[{"fname": "booth", "dim": 2}],
        n_runs=2,
        max_evals=1000,
        alpha=0.05,
        seed_base=0,
    )
    base.update(overrides)
    return BenchmarkConfig(**base)


class EventCollector:
    def __init__(self) -> None:
        self.events: list[tuple[str, BaseModel]] = []

    def __call__(self, event: str, payload: BaseModel) -> None:
        self.events.append((event, payload))

    def of(self, event_name: str) -> list[BaseModel]:
        return [p for name, p in self.events if name == event_name]


@pytest.fixture
def worker_env(tmp_path: Path):
    db_path = tmp_path / "suite.db"
    engine = make_engine(db_path)
    run_migrations(engine, db_path)
    svc = RunService(make_session_factory(engine))
    run_dir = tmp_path / "runs" / "r1"
    run_dir.mkdir(parents=True)
    yield svc, run_dir
    engine.dispose()


class TestBenchmarkWorker:
    def test_mini_benchmark_end_to_end(self, worker_env, tmp_path):
        svc, run_dir = worker_env
        config = make_config()
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
        collector = EventCollector()
        worker = BenchmarkWorker(
            config=config,
            run_id=run.id,
            run_dir=run_dir,
            svc=svc,
            emit=collector,
            cancel_event=threading.Event(),
        )
        worker.start()
        worker.join(timeout=120)
        assert not worker.is_alive()

        # status transitions
        assert svc.get_run(run.id).status == "completed"
        assert svc.get_run(run.id).duration_s is not None

        # events: started, telemetry, run_done (2 runs x 4 algos), scenario_done, complete
        assert len(collector.of("benchmark://started")) == 1
        assert isinstance(collector.of("benchmark://started")[0], StartedEvent)
        assert len(collector.of("benchmark://run_done")) == 8
        assert all(isinstance(p, RunDoneEvent) for p in collector.of("benchmark://run_done"))
        assert len(collector.of("benchmark://scenario_done")) == 1
        assert len(collector.of("benchmark://complete")) == 1
        assert len(collector.of("benchmark://error")) == 0
        assert len(collector.of("benchmark://telemetry")) > 0
        tel = collector.of("benchmark://telemetry")
        assert all(isinstance(p, TelemetryEvent) for p in tel)
        # 2D scenario -> positions present at init phase
        assert any(p.positions for p in tel if p.phase == "init")

        # DB rows: one per (scenario, algo)
        detail = svc.get_run_detail(run.id)
        assert len(detail["scenario_results"]) == 4
        assert {r["algo_key"] for r in detail["scenario_results"]} == {
            "hyde_bin",
            "hyde_qub",
            "hyde_con",
            "hygo",
        }

        # artifacts
        results = (run_dir / "benchmark_results.json").read_text(encoding="utf-8")
        assert "booth_2D" in results
        assert (run_dir / "config.json").exists()
        payloads = list((run_dir / "payloads").glob("*.json.zst"))
        assert len(payloads) == 4

        # 2D scenario -> replay histories recorded per run
        from suite.db.payloads import read_payload

        payload = read_payload(payloads[0])
        histories = payload.get("replay_histories", [])
        assert len(histories) == 2  # n_runs
        assert len(histories[0]) > 0
        first = histories[0][0]
        assert set(first) == {"g", "p", "c"}

    def test_margins_collected(self, worker_env):
        svc, run_dir = worker_env
        config = make_config()
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
        assert len(worker.margins) == 3

    def test_cancellation(self, worker_env):
        svc, run_dir = worker_env
        config = make_config(n_runs=1)
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
        cancel = threading.Event()
        cancel.set()  # cancel before starting
        collector = EventCollector()
        worker = BenchmarkWorker(
            config=config,
            run_id=run.id,
            run_dir=run_dir,
            svc=svc,
            emit=collector,
            cancel_event=cancel,
        )
        worker.start()
        worker.join(timeout=30)
        assert svc.get_run(run.id).status == "cancelled"
        assert len(collector.of("benchmark://cancelled")) == 1
        assert isinstance(
            collector.of("benchmark://cancelled")[0], CancelledEvent
        )


class TestDefaultAlgoKwargs:
    def test_cli_defaults(self):
        kwargs = default_algo_kwargs(AlgoParams())
        assert kwargs["hyde_bin"]["Nb"] == 12
        assert kwargs["hyde_bin"]["pop_size"] is None
        assert kwargs["hyde_qub"] == {
            "pop_size": None,
            "max_gen": 50,
            "phase_split": 0.60,
        }
        hygo = kwargs["hygo"]
        assert hygo["NG"] == 50 and hygo["Nexplor"] == 70 and hygo["Nexploit"] == 30
        assert hygo["Pc"] == 0.55 and hygo["Pm"] == 0.45 and hygo["Pr"] == 0.0


class TestThrottledEmitter:
    def test_telemetry_throttled_per_channel(self):
        calls = []

        def emit(event, payload):
            calls.append((event, payload))

        class P(BaseModel):
            algo_key: str = "hygo"

        emitter = ThrottledEmitter(emit, min_interval=1.0, clock=lambda: 0.0)
        emitter("benchmark://telemetry", P())
        emitter("benchmark://telemetry", P())
        assert len(calls) == 1

    def test_phase_change_passes_through(self):
        calls = []
        emitter = ThrottledEmitter(lambda e, p: calls.append(e), min_interval=1.0, clock=lambda: 0.0)

        class P(BaseModel):
            algo_key: str = "hygo"

        # different channels (algo) are not throttled against each other
        emitter("benchmark://telemetry", P(algo_key="hygo"))
        emitter("benchmark://telemetry", P(algo_key="hyde_bin"))
        assert len(calls) == 2

    def test_non_telemetry_unthrottled(self):
        calls = []
        emitter = ThrottledEmitter(lambda e, p: calls.append(e), min_interval=1.0, clock=lambda: 0.0)

        class P(BaseModel):
            pass

        emitter("benchmark://run_done", P())
        emitter("benchmark://run_done", P())
        assert len(calls) == 2


class TestSurfaceCache:
    def test_compute_and_cache(self):
        cache = SurfaceCache(resolution=10)
        s1 = cache.get("booth")
        assert len(s1["xs"]) == 10
        assert len(s1["zs"]) == 10
        assert s1 is cache.get("booth")  # cached

    def test_unknown_function(self):
        cache = SurfaceCache()
        with pytest.raises(KeyError):
            cache.get("does_not_exist")


class TestAppState:
    def test_start_and_complete(self, tmp_path: Path):
        settings = Settings(_env_file=None)
        object.__setattr__(settings, "suite_data_dir", tmp_path / "data")
        # pydantic v2 models: set via model field
        settings.suite_data_dir = tmp_path / "data"
        state = AppState(settings)
        collector = EventCollector()
        run_id = state.start_benchmark(make_config(max_evals=1000), emit=collector)
        assert state.is_running
        # wait for completion
        while state.is_running:
            threading.Event().wait(0.05)
        detail = state.svc.get_run_detail(run_id)
        assert detail["status"] == "completed"
        assert (tmp_path / "data" / "suite.db").exists()

    def test_double_start_rejected(self, tmp_path: Path):
        settings = Settings(_env_file=None)
        settings.suite_data_dir = tmp_path / "data"
        state = AppState(settings)
        # never join; worker runs a real (tiny) benchmark
        state.start_benchmark(make_config(max_evals=1000), emit=lambda *_: None)
        with pytest.raises(WorkerAlreadyRunning):
            state.start_benchmark(make_config(), emit=lambda *_: None)
        while state.is_running:
            threading.Event().wait(0.05)

    def test_cancel_without_worker(self, tmp_path: Path):
        settings = Settings(_env_file=None)
        settings.suite_data_dir = tmp_path / "data"
        state = AppState(settings)
        with pytest.raises(NoActiveWorker):
            state.cancel_benchmark()
