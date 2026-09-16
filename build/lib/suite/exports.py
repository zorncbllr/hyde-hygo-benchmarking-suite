"""Export facade: regenerates all benchmark artifacts through the reference
implementation's own functions.

Output redirection is done by patching the module-level directory constants
(``CSV_DIR`` / ``CHART_DIR``) of ``hyde_bench.run_benchmark`` for the
duration of the export, so produced files are identical to a CLI run while
landing inside the run's artifact directory.
"""

from __future__ import annotations

import gc
import json
import math
import os
import subprocess
import sys
import threading
import traceback
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Literal

from pydantic import BaseModel, Field

from .db import RunService
from .db.payloads import read_payload

ExportGroup = Literal["csv", "charts", "docx", "json"]

ALL_GROUPS: tuple[ExportGroup, ...] = ("csv", "charts", "docx", "json")

# Upper bound for one chart function rendered in the clean subprocess
# (make_charts loops over every benchmark; the rest render a few figures).
CHART_SUBPROCESS_TIMEOUT = 900

# The export pipeline mutates module-level constants of the reference
# implementation; two overlapping exports would corrupt each other's
# redirects, so the whole pipeline runs under one process-wide lock.
_export_lock = threading.Lock()


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


def load_results(run_dir: Path) -> dict:
    path = Path(run_dir) / "benchmark_results.json"
    if not path.exists():
        raise FileNotFoundError("benchmark_results.json not found; run the benchmark first")
    return json.loads(path.read_text(encoding="utf-8"))


def _jsonify(data):
    """Recursively convert numpy scalars/arrays to plain JSON types and
    replace non-finite floats with ``None`` (serde_json cannot transport
    NaN/Infinity over IPC)."""

    def default(obj):
        import numpy as np

        if isinstance(obj, np.generic):
            return obj.item()
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return str(obj)

    def sanitize(obj):
        if isinstance(obj, dict):
            return {k: sanitize(v) for k, v in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [sanitize(v) for v in obj]
        if isinstance(obj, float) and not math.isfinite(obj):
            return None
        return obj

    return sanitize(json.loads(json.dumps(data, default=default)))


def _write_json(path: Path, data) -> None:
    """Atomically write ``data`` as pretty JSON (numpy-tolerant, IPC-safe)."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(_jsonify(data), indent=2), encoding="utf-8")
    tmp.replace(path)


def compute_analysis_summary(all_results: dict) -> dict:
    """Compute the statistical analysis snapshot that backs the DOCX report
    (sections (a)-(e)) through the reference implementation's own functions.

    Shared by the export pipeline and the on-demand analysis command so the
    desktop UI always mirrors the exported report without re-exporting.
    """
    import hyde_bench.run_benchmark as rb

    friedman_obj = rb.friedman_objective_error(all_results)
    kruskal_results = [
        rb.run_kruskal_per_scenario(key, entry) for key, entry in all_results.items()
    ]
    cochran_result = rb.cochrans_q_test(all_results)
    chi2_conv_results = [
        rb.chi2_convergence_per_scenario(key, entry) for key, entry in all_results.items()
    ]
    friedman_wt = rb.friedman_wall_time(all_results)
    wt_kruskal_results = [
        rb.kruskal_wall_time_per_scenario(key, entry) for key, entry in all_results.items()
    ]
    margin_results = [
        rb.wilcoxon_margin_vs_hygo(key, entry, hyde_key)
        for key, entry in all_results.items()
        for hyde_key in rb.HYDE_KEYS
    ]
    scaling_results = rb.run_scaling_analysis(all_results)

    return {
        "friedman_objective_error": friedman_obj,
        "kruskal_per_scenario": kruskal_results,
        "cochrans_q": cochran_result,
        "chi2_convergence": chi2_conv_results,
        "friedman_wall_time": friedman_wt,
        "wall_time_kruskal": wt_kruskal_results,
        "margin_vs_hygo": margin_results,
        "scaling": scaling_results,
    }


ANALYSIS_SECTION_KEYS = frozenset(
    {
        "friedman_objective_error",
        "kruskal_per_scenario",
        "cochrans_q",
        "chi2_convergence",
        "friedman_wall_time",
        "wall_time_kruskal",
        "margin_vs_hygo",
        "scaling",
    }
)

# Bump when the analysis semantics change so persisted snapshots from older
# builds are recomputed instead of served: 2 = normalized degradation
# ((mean_25D - mean_2D) / max(mean_2D, 1e-12)) replaced the plain
# mean_25D / mean_2D ratio, which produced inf for exact 2D convergence.
ANALYSIS_METRIC_VERSION = 2


def analysis_summary_path(run_dir: Path) -> Path:
    """Location of the persisted statistical analysis snapshot for a run."""
    return Path(run_dir) / "analysis_summary.json"


def is_valid_analysis_summary(data: object) -> bool:
    """Structural check before trusting a cached snapshot: a JSON object
    carrying every report section (a partial file written by an interrupted
    export or manual edit must not reach the UI) and stamped with the
    current metric version (older snapshots carry outdated semantics)."""
    return (
        isinstance(data, dict)
        and ANALYSIS_SECTION_KEYS <= data.keys()
        and data.get("metric_version") == ANALYSIS_METRIC_VERSION
    )


def persist_analysis_summary(path: Path, summary: dict) -> dict:
    """Stamp and atomically write an analysis snapshot (IPC-safe JSON);
    returns the exact dict that was written."""
    stamped = {**summary, "metric_version": ANALYSIS_METRIC_VERSION}
    _write_json(path, stamped)
    return stamped


def get_or_compute_analysis_summary(run_dir: Path, detail: dict) -> dict:
    """Return the run's statistical analysis snapshot, computing it once and
    persisting the result when ``analysis_summary.json`` is missing or
    malformed.

    Shares the export pipeline's computation so the desktop UI always
    mirrors the exported DOCX report; the returned dict is the sanitized
    (IPC-safe) JSON that was written, so cache and response can never
    diverge. Must run off the event loop: it is CPU-bound and takes the
    process-wide reference-module lock.
    """
    run_dir = Path(run_dir)
    path = analysis_summary_path(run_dir)
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = None
        if is_valid_analysis_summary(data):
            return data
    with reference_output_context(run_dir, detail, create_dirs=False):
        summary = _jsonify(compute_analysis_summary(load_results(run_dir)))
    return persist_analysis_summary(path, summary)


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


@contextmanager
def reference_output_context(
    run_dir: Path, detail: dict, *, create_dirs: bool = True
) -> Iterator[None]:
    """Redirect the reference implementation's output constants into
    ``run_dir`` for the duration of the block, and mirror the run's
    configuration (``N_RUNS`` / ``MAX_EVALS`` / ``ALPHA`` / ``TEST_CASES``)
    onto the module so charts and the DOCX report describe the actual
    experiment instead of the CLI defaults (the reference also reads
    ``ALPHA`` at analysis time).

    Serializes against concurrent exports and on-demand analyses: the patched
    globals are process-wide state, so only one pipeline may run at a time.
    """
    import hyde_bench.run_benchmark as rb

    with _export_lock:
        original = (
            rb.CSV_DIR,
            rb.CHART_DIR,
            rb.HERE,
            rb.N_RUNS,
            rb.MAX_EVALS,
            rb.ALPHA,
            rb.TEST_CASES,
        )
        rb.CSV_DIR = str(run_dir / "csv_data")
        rb.CHART_DIR = str(run_dir / "benchmark_charts")
        rb.HERE = str(run_dir)  # benchmark_report.docx destination
        rb.N_RUNS = detail["n_runs"]
        rb.MAX_EVALS = detail["max_evals"]
        rb.ALPHA = detail["alpha"]
        rb.TEST_CASES = [(tc["fname"], tc["dim"]) for tc in detail["test_cases"]]
        if create_dirs:
            Path(rb.CSV_DIR).mkdir(parents=True, exist_ok=True)
            Path(rb.CHART_DIR).mkdir(parents=True, exist_ok=True)
        try:
            yield
        finally:
            (
                rb.CSV_DIR,
                rb.CHART_DIR,
                rb.HERE,
                rb.N_RUNS,
                rb.MAX_EVALS,
                rb.ALPHA,
                rb.TEST_CASES,
            ) = original


# Renderer-geometry corruption inside the embedded app surfaces as these
# recoverable failures; anything matching them is retried in a clean
# subprocess instead of discarding the whole export.
_RECOVERABLE_TOKENS = ("too large", "raster overflow", "bad_alloc")


def is_recoverable_render_error(exc: BaseException) -> bool:
    text = str(exc)
    return any(token in text for token in _RECOVERABLE_TOKENS)


def _install_render_guard(log: Callable[[str], None]) -> None:
    """Patch ``Figure.tight_layout`` and ``Figure.savefig`` once per process.

    Inside the embedded app the renderer geometry can inflate by several
    orders of magnitude (symptoms: "Image size of NNNxNNN pixels is too
    large", then "FT_Render_Glyph: raster overflow"; MemoryError/std::
    bad_alloc when the inflated buffer exceeds memory). ``tight_layout``
    triggers the first render and compounds the inflation across figures
    and export attempts, so it is skipped when it overflows, and savefig
    retries without the ``bbox_inches='tight'`` pass after resetting the
    figure's DPI to the reference implementation's intended value. The
    plain render always fits the Agg 2^23-pixel limit; only the margins
    are untightened. Steps whose plain render still fails are re-run in a
    clean subprocess (see ``chart_worker``) by the export pipeline.

    Offending artists and the observed DPI are dumped to the export log so
    the underlying inflation can be diagnosed.
    """
    from matplotlib.figure import Figure

    if getattr(Figure.savefig, "_suite_fallback", False):
        return

    orig_savefig = Figure.savefig
    orig_tight_layout = Figure.tight_layout

    def _recoverable(exc: BaseException) -> bool:
        return is_recoverable_render_error(exc)

    def dump_culprits(fig: Figure) -> None:
        try:
            import numpy as np

            log(f"figure dpi={fig.dpi} size_inches={fig.get_size_inches()!r}")
            renderer = fig.canvas.get_renderer()
            for artist in fig.get_children():
                bbox = artist.get_tightbbox(renderer)
                if bbox is not None and (
                    not np.isfinite(bbox.width)
                    or not np.isfinite(bbox.height)
                    or bbox.width > 1e4
                    or bbox.height > 1e4
                ):
                    log(
                        f"culprit artist {type(artist).__name__}: "
                        f"bbox={bbox!r} visible={artist.get_visible()} "
                        f"repr={artist!r}"
                    )
        except Exception:  # noqa: BLE001 - diagnostics must never mask the retry
            pass

    def tight_layout(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        try:
            return orig_tight_layout(self, *args, **kwargs)
        except (ValueError, RuntimeError, MemoryError, OverflowError) as exc:
            if not _recoverable(exc):
                raise
            log(f"tight_layout skipped after overflow: {exc}")
            return None

    def savefig(self, fname, *args, **kwargs):  # type: ignore[no-untyped-def]
        try:
            return orig_savefig(self, fname, *args, **kwargs)
        except (ValueError, RuntimeError, MemoryError, OverflowError) as exc:
            if not _recoverable(exc):
                raise
            log(f"tight bbox overflow on {fname}: {exc}")
            dump_culprits(self)
            # The failing draw ran with an inflated figure geometry; reset
            # it before rendering plainly.
            self.set_dpi(100)
            kwargs["bbox_inches"] = None
            try:
                return orig_savefig(self, fname, *args, **kwargs)
            except (ValueError, RuntimeError, MemoryError, OverflowError) as exc2:
                if not _recoverable(exc2):
                    raise
                log(f"fallback render also failed on {fname}: {exc2}")
                raise

    savefig._suite_fallback = True  # type: ignore[attr-defined]
    Figure.savefig = savefig  # type: ignore[method-assign]
    Figure.tight_layout = tight_layout  # type: ignore[method-assign]


CSV_SUBPROCESS_TIMEOUT = 900


def _write_csvs_subprocess(run_dir: Path, detail: dict) -> None:
    """Write the per-run CSVs in a fresh interpreter with a process pool.

    The payloads decompress to ~17MB of JSON each and stdlib json.loads
    holds the GIL, so the sequential in-process loop is CPU-bound; a clean
    single-threaded child with its own pool parses them in parallel.
    Raises when the worker crashes, times out, or reports per-payload
    failures (the caller falls back to the sequential loop).
    """
    spec_path = run_dir / "csv_worker_args.json"
    _write_json(
        spec_path,
        {
            "run_dir": str(run_dir),
            "n_runs": detail["n_runs"],
            "max_evals": detail["max_evals"],
            "alpha": detail["alpha"],
            "test_cases": [{"fname": tc["fname"], "dim": tc["dim"]} for tc in detail["test_cases"]],
            "scenario_results": [
                {
                    "algo_key": sr["algo_key"],
                    "fname": sr["fname"],
                    "dim": sr["dim"],
                    "payloads_path": sr["payloads_path"],
                }
                for sr in detail["scenario_results"]
            ],
        },
    )
    mpl_cfg = run_dir / "mpl_config"
    mpl_cfg.mkdir(parents=True, exist_ok=True)
    env = {
        **os.environ,
        "PYTHONNOUSERSITE": "1",
        "MPLBACKEND": "Agg",
        "MPLCONFIGDIR": str(mpl_cfg),
        "PYTHONPATH": os.pathsep.join(dict.fromkeys(p for p in sys.path if p and os.path.isdir(p))),
    }
    proc = subprocess.run(
        [sys.executable, "-m", "suite.csv_worker", "--args", str(spec_path)],
        capture_output=True,
        text=True,
        timeout=CSV_SUBPROCESS_TIMEOUT,
        env=env,
        check=False,
    )
    if proc.returncode != 0:
        err = (proc.stderr.strip() or proc.stdout.strip())[-4000:]
        raise RuntimeError(f"csv worker failed (exit {proc.returncode}): {err}")
    # the worker prints exactly one JSON line; tolerate stray stdout noise
    lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
    result = json.loads(lines[-1]) if lines else {"failures": ["no output"]}
    if result.get("failures"):
        raise RuntimeError("; ".join(result["failures"][:5]))


def _render_chart_subprocess(run_dir: Path, config: dict, fn_name: str, args: list) -> None:
    """Run one ``hyde_bench.run_benchmark`` chart function in a fresh
    interpreter so corrupted matplotlib state (inflated renderer geometry,
    broken font caches) cannot affect the render."""
    spec_path = run_dir / "chart_render_args.json"
    _write_json(
        spec_path,
        {
            "fn": fn_name,
            "args": list(args),
            "run_dir": str(run_dir),
            "n_runs": config["n_runs"],
            "max_evals": config["max_evals"],
            "alpha": config["alpha"],
            "test_cases": [{"fname": tc["fname"], "dim": tc["dim"]} for tc in config["test_cases"]],
        },
    )
    # a fresh MPLCONFIGDIR protects against corrupted font caches as well;
    # PYTHONNOUSERSITE keeps the child from silently resolving different
    # package versions, while PYTHONPATH pins the parent's resolved import
    # path (dev environments may legitimately resolve the project from a
    # location that would otherwise be dropped without user site)
    mpl_cfg = run_dir / "mpl_config"
    mpl_cfg.mkdir(parents=True, exist_ok=True)
    env = {
        **os.environ,
        "PYTHONNOUSERSITE": "1",
        "MPLBACKEND": "Agg",
        "MPLCONFIGDIR": str(mpl_cfg),
        "PYTHONPATH": os.pathsep.join(dict.fromkeys(p for p in sys.path if p and os.path.isdir(p))),
    }
    proc = subprocess.run(
        [sys.executable, "-m", "suite.chart_worker", "--args", str(spec_path)],
        capture_output=True,
        text=True,
        timeout=CHART_SUBPROCESS_TIMEOUT,
        env=env,
        check=False,
    )
    if proc.returncode != 0:
        detail = (proc.stderr.strip() or proc.stdout.strip())[-4000:]
        raise RuntimeError(
            f"clean-subprocess render of {fn_name} failed (exit {proc.returncode}): {detail}"
        )


def run_exports_sync(
    run_id: str,
    svc: RunService,
    groups: list[ExportGroup],
    progress: Callable[[str], None] | None = None,
) -> dict[str, list[str]]:
    """Execute the export pipeline synchronously and return artifact paths."""
    report = progress or (lambda _msg: None)

    detail = svc.get_run_detail(run_id)
    if detail["status"] == "running":
        raise RuntimeError("run is still in progress; wait for it to finish before exporting")
    run_dir = Path(detail["output_dir"])
    all_results = load_results(run_dir)

    def log(msg: str) -> None:
        try:
            with open(run_dir / "export_error.log", "a", encoding="utf-8") as f:
                f.write(f"--- {msg} ---\n")
        except OSError:
            pass

    import matplotlib

    matplotlib.use("Agg")  # desktop app has no display-bound pyplot
    import matplotlib.pyplot as plt

    # failed export attempts in the same app session leave their figures
    # registered in the global pyplot state; clear them so this run starts
    # from a clean slate
    plt.close("all")
    if plt.rcParams["figure.dpi"] != 100:
        log(f"figure.dpi rc drifted to {plt.rcParams['figure.dpi']!r}; resetting for export")
        plt.rcParams["figure.dpi"] = 100
    _install_render_guard(log)

    import hyde_bench.run_benchmark as rb

    artifacts: dict[str, list[str]] = {group: [] for group in groups}
    failures: list[str] = []

    def guarded(step: str, fn: Callable[[], None]) -> Exception | None:
        """Run one export step; on failure record it (with full traceback
        persisted next to the run) and return the exception so callers can
        decide on a fallback, while everything else keeps going so one
        broken chart or payload never discards everything else."""
        try:
            fn()
        except Exception as exc:  # noqa: BLE001 - reported to the UI/log
            tb = traceback.format_exc()
            try:
                with open(run_dir / "export_error.log", "a", encoding="utf-8") as f:
                    f.write(f"--- {step} ---\n{tb}\n")
            except OSError:
                pass
            failures.append(f"{step}: {exc}")
            return exc
        return None

    def _guarded_per_run(sr: dict) -> None:
        def write() -> None:
            payload = read_payload(Path(sr["payloads_path"]))
            results = _reconstruct_results(payload)
            rb.save_per_run_csv(sr["algo_key"], sr["fname"], sr["dim"], results)
            # a single payload holds ~2.5M parsed floats (full per-eval
            # histories); release it before reading the next one so the
            # sequential reads do not accumulate resident memory
            del payload, results

        guarded(f"save_per_run_csv[{sr['fname']}_{sr['dim']}D/{sr['algo_key']}]", write)

    with reference_output_context(run_dir, detail):
        if "json" in groups:
            # written incrementally by the runner; verified present above
            artifacts["json"].append(str(run_dir / "benchmark_results.json"))

        report("statistical analyses")
        analysis_summary = compute_analysis_summary(all_results)
        friedman_obj = analysis_summary["friedman_objective_error"]
        kruskal_results = analysis_summary["kruskal_per_scenario"]
        cochran_result = analysis_summary["cochrans_q"]
        chi2_conv_results = analysis_summary["chi2_convergence"]
        friedman_wt = analysis_summary["friedman_wall_time"]
        wt_kruskal_results = analysis_summary["wall_time_kruskal"]
        margin_results = analysis_summary["margin_vs_hygo"]
        scaling_results = analysis_summary["scaling"]

        # Persist a JSON snapshot of the statistical analyses so the UI can
        # render them without recomputation. It backs the analysis view even
        # when the json group was not requested, but is only listed as an
        # artifact under that group.
        persist_analysis_summary(analysis_summary_path(run_dir), analysis_summary)
        if "json" in groups:
            artifacts["json"].append(str(analysis_summary_path(run_dir)))

        if "csv" in groups:
            report("per-run and analysis CSVs")
            try:
                _write_csvs_subprocess(run_dir, detail)
            except Exception as exc:  # noqa: BLE001 - fall back, then record
                log(f"parallel CSV worker unavailable; falling back to the in-process loop: {exc}")
                for sr in detail["scenario_results"]:
                    _guarded_per_run(sr)
                gc.collect()
            guarded(
                "analysis CSVs",
                lambda: (
                    rb.save_summary_csv(all_results),
                    rb.save_raw_costs_csv(all_results),
                    rb.save_qa_csv(friedman_obj, kruskal_results),
                    rb.save_qb_csv(cochran_result, chi2_conv_results),
                    rb.save_qc_csv(friedman_wt, wt_kruskal_results),
                    rb.save_qd_csv(margin_results),
                    rb.save_qe_csv(scaling_results),
                ),
            )
            csv_dir = Path(rb.CSV_DIR)
            if not (csv_dir / "benchmark_summary.csv").exists():
                raise RuntimeError("CSV summary was not produced")
            artifacts["csv"].append(str(csv_dir))

        # The DOCX report embeds PNG charts from the chart directory; the
        # reference CLI always renders them first, so a chart-less selection
        # would silently produce a figure-less report.
        chart_dir = Path(rb.CHART_DIR)
        needs_charts = "charts" in groups
        needs_docx = "docx" in groups

        def _normalize_dpi() -> None:
            # renderer geometry has been observed inflating between chart
            # functions inside the app; detect and reset it before each one
            if plt.rcParams["figure.dpi"] != 100:
                log(
                    f"figure.dpi drifted to {plt.rcParams['figure.dpi']!r} "
                    "between chart functions; resetting"
                )
                plt.rcParams["figure.dpi"] = 100

        def chart_step(step: str, fn_name: str, *args) -> None:
            """Render one chart step in-process; if the renderer geometry
            corruption makes even the plain-bbox fallback fail, re-run the
            same reference function in a clean subprocess so the chart is
            still produced."""
            _normalize_dpi()
            err = guarded(step, lambda: getattr(rb, fn_name)(*args))
            if err is None or not is_recoverable_render_error(err):
                return
            log(f"re-rendering {fn_name} in clean subprocess")
            report(f"{step}: re-rendering in clean subprocess")
            idx = len(failures) - 1
            retry_err = guarded(
                f"{step} (clean subprocess)",
                lambda: _render_chart_subprocess(run_dir, detail, fn_name, list(args)),
            )
            if retry_err is None:
                # the in-process failure was fully recovered by the
                # subprocess render; do not surface it as an export failure
                del failures[idx]

        if needs_charts or (needs_docx and not any(chart_dir.glob("*.png"))):
            if needs_charts:
                report("matplotlib charts")
            chart_step(
                "make_charts",
                "make_charts",
                all_results,
                kruskal_results,
                margin_results,
            )
            if scaling_results:
                # reduced runs without 25D scenarios produce no scaling data
                chart_step("make_scaling_chart", "make_scaling_chart", scaling_results)
            chart_step("make_cost_charts", "make_cost_charts", all_results)
            chart_step("make_convergence_charts", "make_convergence_charts", all_results)
            chart_step("make_figure5_curves", "make_figure5_curves", all_results)
            chart_step("make_bootstrap_ci_chart", "make_bootstrap_ci_chart", margin_results)
            if needs_charts:
                if not any(chart_dir.glob("*.png")):
                    raise RuntimeError(
                        "no chart PNGs were produced: " + ("; ".join(failures) or "unknown cause")
                    )
                artifacts["charts"].append(str(chart_dir))

        if needs_docx:
            report("DOCX report")
            guarded(
                "generate_docx_report",
                lambda: rb.generate_docx_report(
                    all_results,
                    friedman_obj,
                    kruskal_results,
                    cochran_result,
                    chi2_conv_results,
                    friedman_wt,
                    margin_results,
                    scaling_results,
                ),
            )
            docx_path = run_dir / "benchmark_report.docx"
            if not docx_path.exists() or docx_path.stat().st_size == 0:
                raise RuntimeError(
                    "DOCX report was not produced: " + ("; ".join(failures) or "unknown cause")
                )
            artifacts["docx"].append(str(docx_path))

    if failures:
        # artifacts written so far stay on disk, but the UI must not show a
        # clean success when steps failed
        raise RuntimeError(
            "export finished with failures ("
            + "; ".join(failures)
            + "); details in export_error.log"
        )

    return artifacts
