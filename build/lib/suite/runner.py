"""Benchmark worker: runs the experiment loop in a background thread.

The loop mirrors ``hyde_bench.run_benchmark.main()`` exactly (scenario order,
seeding scheme ``seed_base + i*1000 + dim*7``, algorithm kwargs) so results
are identical to the CLI. Progress is streamed through an emit callback and
each scenario is persisted to the run history database plus zstd payloads.
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any, Callable

from pydantic import BaseModel

from hyde_bench.benchmarks import FUNCTIONS
from hyde_bench.hyde_bin import HyDEBin
from hyde_bench.hyde_con import HyDECon
from hyde_bench.hyde_qub import HyDEQub
from hyde_bench.hygo import HyGO
from hyde_bench.run_benchmark import (
    ALGO_KEYS,
    HYDE_KEYS,
    _get_global_opt,
    summarize,
    wilcoxon_margin_vs_hygo,
)

from .db import RunService
from .db.payloads import write_payload
from .schemas import (
    AlgoParams,
    BenchmarkConfig,
    CancelledEvent,
    CompleteEvent,
    ErrorEvent,
    RunDoneEvent,
    ScenarioDoneEvent,
    StartedEvent,
    TelemetryEvent,
)

ALGO_CLASSES = {
    "hyde_bin": HyDEBin,
    "hyde_qub": HyDEQub,
    "hyde_con": HyDECon,
    "hygo": HyGO,
}

TELEMETRY_GEN_BEST_TAIL = 64
REPLAY_MAX_POINTS = 64
REPLAY_MAX_GENS = 200


class RunnerCancelled(Exception):
    """Raised internally when cancellation is requested."""


def default_algo_kwargs(params: AlgoParams) -> dict[str, dict]:
    """Algorithm kwargs mirroring ``main()`` defaults, overridable per run."""
    hyde = dict(
        pop_size=None,
        max_gen=params.hyde.max_gen,
        phase_split=params.hyde.phase_split,
    )
    hygo = dict(
        Nb=params.hygo.Nb,
        NG=params.hygo.NG,
        Nexplor=params.hygo.Nexplor,
        Nexploit=params.hygo.Nexploit,
        Ne=params.hygo.Ne,
        ps=params.hygo.ps,
        Pc=params.hygo.Pc,
        Pm=params.hygo.Pm,
        Pr=params.hygo.Pr,
    )
    return {
        "hyde_bin": {**hyde, "Nb": params.hyde.Nb},
        "hyde_qub": hyde,
        "hyde_con": hyde,
        "hygo": hygo,
    }


class BenchmarkWorker(threading.Thread):
    def __init__(
        self,
        *,
        config: BenchmarkConfig,
        run_id: str,
        run_dir: Path,
        svc: RunService,
        emit: Callable[[str, BaseModel], None],
        cancel_event: threading.Event,
    ) -> None:
        super().__init__(daemon=True, name=f"benchmark-worker-{run_id}")
        self.config = config
        self.run_id = run_id
        self.run_dir = run_dir
        self.svc = svc
        self.emit = emit
        self.cancel_event = cancel_event

        # progress counters (read by the UI via get_active_run)
        self._counter_lock = threading.Lock()
        self.completed_runs = 0
        self.scenarios_done = 0
        self.current_fname: str | None = None
        self.current_dim: int | None = None
        self.current_algo: str | None = None
        self.total_runs = self.config.n_runs * 4 * len(self.config.test_cases)
        self.n_scenarios = len(self.config.test_cases)
        self._run_history: list[dict] | None = None
        # per (scenario, algo) replay data: algo_key -> list of runs, each a
        # list of {g, p, c} generation entries (2D scenarios only)
        self.replay_histories: dict[str, list[list[dict]]] = {}

        (self.run_dir / "payloads").mkdir(parents=True, exist_ok=True)
        (self.run_dir / "config.json").write_text(
            config.model_dump_json(indent=2), encoding="utf-8"
        )

    def snapshot(self) -> dict:
        """Thread-safe progress snapshot for the UI."""
        with self._counter_lock:
            return {
                "run_id": self.run_id,
                "status": "running",
                "total_runs": self.total_runs,
                "completed_runs": self.completed_runs,
                "scenarios": self.n_scenarios,
                "scenarios_done": self.scenarios_done,
                "current_fname": self.current_fname,
                "current_dim": self.current_dim,
                "current_algo": self.current_algo,
            }

    # -- thread body ------------------------------------------------------------

    def run(self) -> None:
        t0 = time.monotonic()
        try:
            self.svc.mark_running(self.run_id)
            self.emit(
                "benchmark://started",
                StartedEvent(
                    run_id=self.run_id,
                    total_runs=self.config.n_runs * 4 * len(self.config.test_cases),
                    scenarios=len(self.config.test_cases),
                ),
            )
            self._execute(t0)
        except RunnerCancelled:
            self.svc.mark_cancelled(self.run_id)
            self.emit("benchmark://cancelled", CancelledEvent(run_id=self.run_id))
        except Exception as exc:  # noqa: BLE001 - report everything to UI
            try:
                self.svc.mark_failed(self.run_id, reason=str(exc))
            except Exception:  # noqa: BLE001 - never mask the original error
                pass
            self.emit(
                "benchmark://error",
                ErrorEvent(run_id=self.run_id, error=str(exc)),
            )

    def _execute(self, t0: float) -> None:
        all_results: dict[str, Any] = {}
        self.margins: list[Any] = []
        algo_kwargs = default_algo_kwargs(self.config.algo_params)

        for fname, dim in [(tc.fname, tc.dim) for tc in self.config.test_cases]:
            key = f"{fname}_{dim}D"
            entry = {}
            results_by_algo: dict[str, list[dict]] = {}
            for algo_key in ALGO_KEYS:
                if self.cancel_event.is_set():
                    raise RunnerCancelled
                cls = ALGO_CLASSES[algo_key]
                kwargs = dict(algo_kwargs[algo_key])
                if algo_key == "hygo":
                    kwargs["NT"] = 7 if dim <= 5 else 100
                results = self._run_case(cls, fname, dim, key, algo_key, kwargs)
                results_by_algo[algo_key] = results
                entry[algo_key] = summarize(results, fname, dim)

            all_results[key] = entry
            self._persist_scenario(fname, dim, key, entry, results_by_algo)
            with self._counter_lock:
                self.scenarios_done += 1

            medians = {k: entry[k]["median_best"] for k in ALGO_KEYS}
            best_k = min(medians, key=medians.get)
            for hyde_key in HYDE_KEYS:
                self.margins.append(
                    wilcoxon_margin_vs_hygo(key, entry, hyde_key)
                )

            (self.run_dir / "benchmark_results.json").write_text(
                json.dumps(all_results, indent=2), encoding="utf-8"
            )
            self.emit(
                "benchmark://scenario_done",
                ScenarioDoneEvent(
                    run_id=self.run_id,
                    key=key,
                    elapsed_s=time.monotonic() - t0,
                    best_algo=best_k,
                    medians=medians,
                ),
            )

        self.svc.mark_completed(self.run_id, duration_s=time.monotonic() - t0)
        self.emit(
            "benchmark://complete",
            CompleteEvent(
                run_id=self.run_id,
                duration_s=time.monotonic() - t0,
                scenarios=len(all_results),
            ),
        )

    # -- per-algorithm runs -------------------------------------------------------

    def _run_case(
        self,
        algo_class,
        fname: str,
        dim: int,
        key: str,
        algo_key: str,
        algo_kwargs: dict,
    ) -> list[dict]:
        func = FUNCTIONS[fname]
        results: list[dict] = []
        self.replay_histories[algo_key] = []
        for i in range(self.config.n_runs):
            if self.cancel_event.is_set():
                raise RunnerCancelled
            seed = self.config.seed_base + i * 1000 + dim * 7
            run_history: list[dict] = []
            self._run_history = run_history
            algo = algo_class(
                func=func,
                fname=fname,
                dim=dim,
                max_evals=self.config.max_evals,
                seed=seed,
                progress_hook=self._make_hook(key, algo_key, i),
                **algo_kwargs,
            )
            t0 = time.perf_counter()
            with self._counter_lock:
                self.current_fname = fname
                self.current_dim = dim
                self.current_algo = algo_key
            r = algo.run()
            r["wall_ms"] = (time.perf_counter() - t0) * 1000
            results.append(r)
            self.replay_histories[algo_key].append(run_history)
            with self._counter_lock:
                self.completed_runs += 1
                completed = self.completed_runs
            self.emit(
                "benchmark://run_done",
                RunDoneEvent(
                    run_id=self.run_id,
                    fname=fname,
                    dim=dim,
                    algo_key=algo_key,
                    run_idx=i,
                    n_runs=self.config.n_runs,
                    best_cost=float(r["best_cost"]),
                    wall_ms=float(r["wall_ms"]),
                    conv_gen=r["conv_gen"],
                    completed=completed,
                    total=self.total_runs,
                ),
            )
        return results

    def _make_hook(self, key: str, algo_key: str, run_idx: int):
        fname, dim_s = key.rsplit("_", 1)
        dim = int(dim_s.rstrip("D"))

        def hook(snap: dict) -> None:
            if self.cancel_event.is_set():
                return  # cancellation is enforced between runs; skip telemetry
            # collect the replay entry (2D scenarios only); compact storage:
            # gen, best position, population capped at REPLAY_MAX_POINTS
            if self._run_history is not None and len(self._run_history) < REPLAY_MAX_GENS:
                positions = snap.get("positions")
                self._run_history.append(
                    {
                        "g": snap["gen"],
                        "p": snap.get("best_pos"),
                        "c": positions[:REPLAY_MAX_POINTS] if positions else None,
                    }
                )
            self.emit(
                "benchmark://telemetry",
                TelemetryEvent(
                    run_id=self.run_id,
                    fname=fname,
                    dim=dim,
                    algo_key=algo_key,
                    run_idx=run_idx,
                    n_runs=self.config.n_runs,
                    phase=snap["phase"],
                    gen=snap["gen"],
                    eval_count=snap["eval_count"],
                    best_cost=snap["best_cost"],
                    gen_best_tail=snap["gen_best_tail"],
                    positions=snap["positions"],
                    best_pos=snap.get("best_pos"),
                ),
            )

        return hook

    # -- persistence ---------------------------------------------------------------

    _PAYLOAD_KEYS = (
        "raw_costs",
        "raw_wall_ms",
        "raw_evals",
        "raw_aucs",
        "raw_obj_errors",
        "mean_curve",
        "curves",
        "conv_binary",
    )

    def _persist_scenario(
        self,
        fname: str,
        dim: int,
        key: str,
        entry: dict[str, Any],
        results_by_algo: dict[str, list[dict]],
    ) -> None:
        global_opt = _get_global_opt(fname, dim)
        for algo_key in ALGO_KEYS:
            summary = entry[algo_key]
            results = results_by_algo[algo_key]
            payload = {k: summary[k] for k in self._PAYLOAD_KEYS if k in summary}
            payload["global_opt"] = global_opt
            payload["conv_gens"] = [r["conv_gen"] for r in results]
            payload["cost_histories"] = [r["cost_history"] for r in results]
            payload["replay_histories"] = self.replay_histories.get(algo_key, [])
            path = self.run_dir / "payloads" / f"{key}_{algo_key}.json.zst"
            write_payload(path, payload)
            self.svc.add_scenario_result(
                self.run_id,
                {
                    "fname": fname,
                    "dim": dim,
                    "algo_key": algo_key,
                    "payloads_path": str(path),
                    "converged_all": summary["conv_pct"] == 100.0,
                    **{
                        col: summary[col]
                        for col in (
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
                        )
                    },
                },
            )
