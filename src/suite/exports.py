"""Export facade: regenerates all benchmark artifacts through the reference
implementation's own functions.

Output redirection is done by patching the module-level directory constants
(``CSV_DIR`` / ``CHART_DIR``) of ``hyde_bench.run_benchmark`` for the
duration of the export, so produced files are identical to a CLI run while
landing inside the run's artifact directory.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Callable, Literal

from pydantic import BaseModel, Field

from .db import RunService
from .db.payloads import read_payload

ExportGroup = Literal["csv", "charts", "docx", "json"]

ALL_GROUPS: tuple[ExportGroup, ...] = ("csv", "charts", "docx", "json")


# -- event payloads ------------------------------------------------------------


class ExportProgressEvent(BaseModel):
    run_id: str
    message: str


class ExportDoneEvent(BaseModel):
    run_id: str
    artifacts: dict


class ExportErrorEvent(BaseModel):
    run_id: str
    error: str


class ExportRequest(BaseModel):
    run_id: str
    groups: list[str] = Field(default_factory=lambda: list(ALL_GROUPS))

    @property
    def validated_groups(self) -> list[ExportGroup]:
        unknown = [g for g in self.groups if g not in ALL_GROUPS]
        if unknown:
            raise ValueError(f"unknown export groups: {unknown}")
        if not self.groups:
            raise ValueError("at least one export group is required")
        return self.groups  # type: ignore[return-value]


class ExportRunner:
    """Runs exports in a background thread and reports progress via ``emit``."""

    def __init__(
        self,
        *,
        run_id: str,
        svc: RunService,
        emit: Callable[[str, BaseModel], None],
    ) -> None:
        self.run_id = run_id
        self.svc = svc
        self.emit = emit

    def start(self, groups: list[ExportGroup]) -> None:
        thread = threading.Thread(
            target=self._execute,
            args=(groups,),
            daemon=True,
            name=f"export-{self.run_id}",
        )
        thread.start()

    def _execute(self, groups: list[ExportGroup]) -> None:
        try:
            artifacts = run_exports_sync(
                self.run_id,
                self.svc,
                groups,
                progress=lambda m: self.emit(
                    "export://progress",
                    ExportProgressEvent(run_id=self.run_id, message=m),
                ),
            )
            self.emit(
                "export://done",
                ExportDoneEvent(run_id=self.run_id, artifacts=artifacts),
            )
        except Exception as exc:  # noqa: BLE001 - reported to the UI
            self.emit(
                "export://error",
                ExportErrorEvent(run_id=self.run_id, error=str(exc)),
            )


# -- synchronous export pipeline ------------------------------------------------


def _load_results(run_dir: Path) -> dict:
    path = run_dir / "benchmark_results.json"
    if not path.exists():
        raise FileNotFoundError(
            "benchmark_results.json not found; run the benchmark first"
        )
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, data) -> None:
    """JSON dump tolerant of numpy scalars and arrays."""

    def default(obj):
        import numpy as np

        if isinstance(obj, np.generic):
            return obj.item()
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return str(obj)

    path.write_text(
        json.dumps(data, indent=2, default=default), encoding="utf-8"
    )


def _reconstruct_results(payload: dict) -> list[dict]:
    """Rebuild minimal per-run result dicts for ``save_per_run_csv``."""
    n = len(payload["raw_costs"])
    conv_gens = payload.get("conv_gens") or [None] * n
    histories = payload.get("cost_histories") or [[] for _ in range(n)]
    return [
        {
            "best_cost": payload["raw_costs"][i],
            "evals": payload["raw_evals"][i],
            "wall_ms": payload["raw_wall_ms"][i],
            "conv_gen": conv_gens[i],
            "cost_history": histories[i],
        }
        for i in range(n)
    ]


def run_exports_sync(
    run_id: str,
    svc: RunService,
    groups: list[ExportGroup],
    progress: Callable[[str], None] | None = None,
) -> dict[str, list[str]]:
    """Execute the export pipeline synchronously and return artifact paths."""
    report = progress or (lambda _msg: None)

    import matplotlib

    matplotlib.use("Agg")  # desktop app has no display-bound pyplot

    import hyde_bench.run_benchmark as rb

    detail = svc.get_run_detail(run_id)
    run_dir = Path(detail["output_dir"])
    all_results = _load_results(run_dir)

    artifacts: dict[str, list[str]] = {group: [] for group in groups}

    # Redirect reference-module outputs into the run directory.
    original_csv = rb.CSV_DIR
    original_chart = rb.CHART_DIR
    original_here = rb.HERE
    rb.CSV_DIR = str(run_dir / "csv_data")
    rb.CHART_DIR = str(run_dir / "benchmark_charts")
    rb.HERE = str(run_dir)  # benchmark_report.docx destination
    Path(rb.CSV_DIR).mkdir(parents=True, exist_ok=True)
    Path(rb.CHART_DIR).mkdir(parents=True, exist_ok=True)

    try:
        if "json" in groups:
            # written incrementally by the runner; verified present above
            artifacts["json"].append(str(run_dir / "benchmark_results.json"))

        report("statistical analyses")
        friedman_obj = rb.friedman_objective_error(all_results)
        kruskal_results = [
            rb.run_kruskal_per_scenario(key, entry)
            for key, entry in all_results.items()
        ]
        cochran_result = rb.cochrans_q_test(all_results)
        chi2_conv_results = [
            rb.chi2_convergence_per_scenario(key, entry)
            for key, entry in all_results.items()
        ]
        friedman_wt = rb.friedman_wall_time(all_results)
        wt_kruskal_results = [
            rb.kruskal_wall_time_per_scenario(key, entry)
            for key, entry in all_results.items()
        ]
        margin_results = [
            rb.wilcoxon_margin_vs_hygo(key, entry, hyde_key)
            for key, entry in all_results.items()
            for hyde_key in rb.HYDE_KEYS
        ]
        scaling_results = rb.run_scaling_analysis(all_results)

        # Persist a JSON snapshot of the statistical analyses so the UI can
        # render them without recomputation.
        analysis_summary = {
            "friedman_objective_error": friedman_obj,
            "kruskal_per_scenario": kruskal_results,
            "cochrans_q": cochran_result,
            "chi2_convergence": chi2_conv_results,
            "friedman_wall_time": friedman_wt,
            "wall_time_kruskal": wt_kruskal_results,
            "margin_vs_hygo": margin_results,
            "scaling": scaling_results,
        }
        _write_json(run_dir / "analysis_summary.json", analysis_summary)
        artifacts.setdefault("json", []).append(
            str(run_dir / "analysis_summary.json")
        )

        if "csv" in groups:
            report("per-run and analysis CSVs")
            for sr in detail["scenario_results"]:
                payload = read_payload(Path(sr["payloads_path"]))
                results = _reconstruct_results(payload)
                rb.save_per_run_csv(sr["algo_key"], sr["fname"], sr["dim"], results)
            rb.save_summary_csv(all_results)
            rb.save_raw_costs_csv(all_results)
            rb.save_qa_csv(friedman_obj, kruskal_results)
            rb.save_qb_csv(cochran_result, chi2_conv_results)
            rb.save_qc_csv(friedman_wt, wt_kruskal_results)
            rb.save_qd_csv(margin_results)
            rb.save_qe_csv(scaling_results)
            artifacts["csv"].append(str(rb.CSV_DIR))

        if "charts" in groups:
            report("matplotlib charts")
            rb.make_charts(all_results, kruskal_results, margin_results)
            if scaling_results:
                # reduced runs without 25D scenarios produce no scaling data
                rb.make_scaling_chart(scaling_results)
            rb.make_cost_charts(all_results)
            rb.make_convergence_charts(all_results)
            rb.make_figure5_curves(all_results)
            rb.make_bootstrap_ci_chart(margin_results)
            artifacts["charts"].append(str(rb.CHART_DIR))

        if "docx" in groups:
            report("DOCX report")
            rb.generate_docx_report(
                all_results,
                friedman_obj,
                kruskal_results,
                cochran_result,
                chi2_conv_results,
                friedman_wt,
                margin_results,
                scaling_results,
            )
            artifacts["docx"].append(str(run_dir / "benchmark_report.docx"))
    finally:
        rb.CSV_DIR = original_csv
        rb.CHART_DIR = original_chart
        rb.HERE = original_here

    return artifacts
