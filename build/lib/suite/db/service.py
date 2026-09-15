"""CRUD and batch operations for run history.

All mutations go through this service and are transactional. Filesystem
side effects (payload files, run artifact directories) are the caller's
responsibility; the service only records and returns paths.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload, sessionmaker

from .models import (
    AlgoParamsRow,
    Run,
    RunStatus,
    ScenarioResult,
    Tag,
    TestCaseSel,
    new_run_id,
)

_SORT_COLUMNS = {
    "created_at": Run.created_at,
    "label": Run.label,
    "duration_s": Run.duration_s,
    "status": Run.status,
    "n_runs": Run.n_runs,
}

# Allowed status transitions; anything else is rejected.
_TRANSITIONS = {
    RunStatus.DRAFT: {RunStatus.RUNNING},
    RunStatus.RUNNING: {RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED},
    RunStatus.COMPLETED: set(),
    RunStatus.FAILED: set(),
    RunStatus.CANCELLED: set(),
}


class RunServiceError(ValueError):
    """Domain-level validation error raised by the service."""


_EAGER = (
    selectinload(Run.test_cases),
    selectinload(Run.scenario_results),
    selectinload(Run.tags),
    selectinload(Run.algo_params),
)
"""Eager-load options: returned Run objects are used after session close."""


def _clean_label(label: str) -> str:
    label = (label or "").strip()
    if not label:
        raise RunServiceError("label must not be empty")
    if len(label) > 256:
        raise RunServiceError("label must be at most 256 characters")
    return label


def _clean_test_cases(test_cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, int]] = set()
    cleaned: list[dict[str, Any]] = []
    for tc in test_cases:
        fname = str(tc["fname"]).strip()
        dim = int(tc["dim"])
        if not fname:
            raise RunServiceError("test case fname must not be empty")
        if dim < 2:
            raise RunServiceError("test case dim must be >= 2")
        key = (fname, dim)
        if key not in seen:
            seen.add(key)
            cleaned.append({"fname": fname, "dim": dim})
    if not cleaned:
        raise RunServiceError("at least one test case is required")
    return cleaned


class RunService:
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._sf = session_factory

    # -- Creation and lifecycle ------------------------------------------------

    def create_run(
        self,
        *,
        label: str,
        output_dir: str,
        n_runs: int,
        max_evals: int,
        alpha: float,
        seed_base: int,
        algo_params: dict,
        test_cases: list[dict[str, Any]],
    ) -> Run:
        if n_runs < 1 or n_runs > 500:
            raise RunServiceError("n_runs must be between 1 and 500")
        if max_evals < 1000:
            raise RunServiceError("max_evals must be at least 1000")
        if not 0.001 <= alpha <= 0.2:
            raise RunServiceError("alpha must be between 0.001 and 0.2")
        if seed_base < 0:
            raise RunServiceError("seed_base must be non-negative")

        run = Run(
            id=new_run_id(),
            label=_clean_label(label),
            output_dir=output_dir,
            n_runs=n_runs,
            max_evals=max_evals,
            alpha=alpha,
            seed_base=seed_base,
            status=RunStatus.DRAFT,
        )
        run.algo_params = AlgoParamsRow(payload=algo_params)
        run.test_cases = [
            TestCaseSel(fname=tc["fname"], dim=tc["dim"])
            for tc in _clean_test_cases(test_cases)
        ]

        with self._sf() as session:
            session.add(run)
            session.commit()
            return run

    def _transition(self, run_id: str, target: RunStatus, **updates: Any) -> Run:
        with self._sf() as session:
            run = session.get(Run, run_id, options=_EAGER)
            if run is None:
                raise KeyError(f"run {run_id} not found")
            if target not in _TRANSITIONS[RunStatus(run.status)]:
                raise RunServiceError(
                    f"invalid transition {run.status} -> {target.value}"
                )
            run.status = target
            for key, value in updates.items():
                setattr(run, key, value)
            session.commit()
            return run

    def mark_running(self, run_id: str) -> Run:
        return self._transition(run_id, RunStatus.RUNNING)

    def mark_completed(self, run_id: str, duration_s: float) -> Run:
        return self._transition(
            run_id, RunStatus.COMPLETED, duration_s=duration_s
        )

    def mark_failed(self, run_id: str, reason: str | None = None) -> Run:
        run_notes = f"failed: {reason}" if reason else None
        return self._transition(run_id, RunStatus.FAILED, notes=run_notes)

    def mark_cancelled(self, run_id: str) -> Run:
        return self._transition(run_id, RunStatus.CANCELLED)

    # -- Scenario results ------------------------------------------------------

    _METRIC_COLUMNS = (
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

    def add_scenario_result(self, run_id: str, row: dict[str, Any]) -> ScenarioResult:
        """Attach one (scenario, algorithm) summary to a running run.

        Non-finite metric values (nan/inf; e.g. std of a single run) are
        stored as NULL instead of raising integrity errors.
        """
        import math

        if row.get("algo_key") not in ("hyde_bin", "hyde_qub", "hyde_con", "hygo"):
            raise RunServiceError(f"unknown algo_key: {row.get('algo_key')!r}")
        if not row.get("payloads_path"):
            raise RunServiceError("payloads_path is required")
        with self._sf() as session:
            run = session.get(Run, run_id, options=_EAGER)
            if run is None:
                raise KeyError(f"run {run_id} not found")
            if RunStatus(run.status) is not RunStatus.RUNNING:
                raise RunServiceError(
                    f"scenario results can only be added to running runs, "
                    f"got status {run.status}"
                )
            metrics: dict[str, float | None] = {}
            for col in self._METRIC_COLUMNS:
                value = row.get(col)
                if value is None:
                    metrics[col] = None
                    continue
                value = float(value)
                metrics[col] = value if math.isfinite(value) else None
            result = ScenarioResult(
                run_id=run_id,
                fname=str(row["fname"]),
                dim=int(row["dim"]),
                algo_key=str(row["algo_key"]),
                payloads_path=str(row["payloads_path"]),
                converged_all=bool(row.get("converged_all", False)),
                **metrics,
            )
            session.add(result)
            session.commit()
            return result

    # -- Queries ---------------------------------------------------------------

    def get_run(self, run_id: str) -> Run:
        with self._sf() as session:
            run = session.get(Run, run_id, options=_EAGER)
            if run is None:
                raise KeyError(f"run {run_id} not found")
            return run

    def get_run_detail(self, run_id: str) -> dict[str, Any]:
        run = self.get_run(run_id)
        return {
            "id": run.id,
            "created_at": run.created_at.isoformat(),
            "updated_at": run.updated_at.isoformat(),
            "label": run.label,
            "notes": run.notes,
            "status": run.status,
            "duration_s": run.duration_s,
            "output_dir": run.output_dir,
            "seed_base": run.seed_base,
            "n_runs": run.n_runs,
            "max_evals": run.max_evals,
            "alpha": run.alpha,
            "algo_params": run.algo_params.payload if run.algo_params else None,
            "test_cases": [
                {"fname": tc.fname, "dim": tc.dim} for tc in run.test_cases
            ],
            "scenario_results": [
                {
                    "fname": sr.fname,
                    "dim": sr.dim,
                    "algo_key": sr.algo_key,
                    "payloads_path": sr.payloads_path,
                    "converged_all": sr.converged_all,
                    **{col: getattr(sr, col) for col in self._METRIC_COLUMNS},
                }
                for sr in run.scenario_results
            ],
            "tags": [t.name for t in run.tags],
        }

    def list_runs(
        self,
        *,
        status: str | None = None,
        tag: str | None = None,
        search: str | None = None,
        sort: str = "created_at",
        order: str = "desc",
        page: int = 1,
        per_page: int = 20,
    ) -> dict[str, Any]:
        if sort not in _SORT_COLUMNS:
            raise RunServiceError(f"cannot sort by {sort!r}")
        if order not in ("asc", "desc"):
            raise RunServiceError(f"invalid order {order!r}")
        if page < 1:
            raise RunServiceError("page must be >= 1")
        per_page = min(max(1, per_page), 100)

        column = _SORT_COLUMNS[sort]
        order_by = column.desc() if order == "desc" else column.asc()

        with self._sf() as session:
            query = select(Run).options(*_EAGER)
            if status is not None:
                query = query.where(Run.status == status)
            if tag is not None:
                query = query.join(Run.tags).where(Tag.name == tag)
            if search:
                pattern = f"%{search}%"
                query = query.where(
                    or_(Run.label.like(pattern), Run.notes.like(pattern))
                )

            total = session.scalar(
                select(func.count()).select_from(query.subquery())
            )
            runs = (
                session.scalars(
                    query.order_by(order_by, Run.created_at.desc())
                    .offset((page - 1) * per_page)
                    .limit(per_page)
                )
                .unique()
                .all()
            )
            return {
                "items": [
                    {
                        "id": r.id,
                        "label": r.label,
                        "status": r.status,
                        "created_at": r.created_at.isoformat(),
                        "duration_s": r.duration_s,
                        "output_dir": r.output_dir,
                        "n_runs": r.n_runs,
                        "max_evals": r.max_evals,
                        "alpha": r.alpha,
                        "scenarios": len(r.test_cases),
                        "tags": [t.name for t in r.tags],
                    }
                    for r in runs
                ],
                "total": int(total or 0),
                "page": page,
                "per_page": per_page,
            }

    def compare_runs(self, run_ids: list[str]) -> dict[str, Any]:
        if not 2 <= len(run_ids) <= 4:
            raise RunServiceError("compare requires between 2 and 4 runs")
        with self._sf() as session:
            runs = {
                r.id: r
                for r in session.scalars(
                    select(Run).options(*_EAGER).where(Run.id.in_(run_ids)).options(*_EAGER)
                ).unique()
            }
            missing = [rid for rid in run_ids if rid not in runs]
            if missing:
                raise KeyError(f"runs not found: {missing}")
            return {
                rid: {
                    "label": run.label,
                    "status": run.status,
                    "max_evals": run.max_evals,
                    "n_runs": run.n_runs,
                    "results": {
                        f"{sr.fname}_{sr.dim}D::{sr.algo_key}": {
                            **{col: getattr(sr, col) for col in self._METRIC_COLUMNS},
                            "conv_pct": sr.conv_pct,
                        }
                        for sr in run.scenario_results
                    },
                }
                for rid, run in runs.items()
            }

    # -- Updates ---------------------------------------------------------------

    def update_run(
        self,
        run_id: str,
        *,
        label: str | None = None,
        notes: str | None = None,
    ) -> Run:
        with self._sf() as session:
            run = session.get(Run, run_id, options=_EAGER)
            if run is None:
                raise KeyError(f"run {run_id} not found")
            if label is not None:
                run.label = _clean_label(label)
            if notes is not None:
                run.notes = notes
            run.updated_at = datetime.now(UTC)
            session.commit()
            return run

    def set_tags(self, run_id: str, tag_names: list[str]) -> list[str]:
        """Replace the tag set of one run (creating tags as needed)."""
        cleaned = sorted({t.strip() for t in tag_names if t and t.strip()})
        for name in cleaned:
            if len(name) > 64:
                raise RunServiceError(f"tag {name!r} exceeds 64 characters")
        with self._sf() as session:
            run = session.get(Run, run_id, options=_EAGER)
            if run is None:
                raise KeyError(f"run {run_id} not found")
            tags: list[Tag] = []
            for name in cleaned:
                tag = session.scalar(select(Tag).where(Tag.name == name))
                if tag is None:
                    tag = Tag(name=name)
                    session.add(tag)
                tags.append(tag)
            run.tags = tags
            run.updated_at = datetime.now(UTC)
            session.commit()
            return [t.name for t in run.tags]

    # -- Batch operations ------------------------------------------------------

    def tag_runs(
        self, run_ids: list[str], *, add: list[str], remove: list[str]
    ) -> int:
        """Batch add/remove tags. Returns the number of updated runs."""
        if not run_ids:
            raise RunServiceError("no runs selected")
        add_set = {t.strip() for t in add if t and t.strip()}
        remove_set = {t.strip() for t in remove if t and t.strip()}
        overlap = add_set & remove_set
        if overlap:
            raise RunServiceError(f"cannot add and remove {sorted(overlap)}")
        with self._sf() as session:
            runs = (
                session.scalars(select(Run).options(*_EAGER).where(Run.id.in_(run_ids)).options(*_EAGER)).unique().all()
            )
            missing = [rid for rid in run_ids if rid not in {r.id for r in runs}]
            if missing:
                raise KeyError(f"runs not found: {missing}")

            def _get_tag(name: str) -> Tag:
                tag = session.scalar(select(Tag).where(Tag.name == name))
                if tag is None:
                    tag = Tag(name=name)
                    session.add(tag)
                return tag

            for run in runs:
                names = {t.name for t in run.tags}
                names |= add_set
                names -= remove_set
                run.tags = [_get_tag(n) for n in sorted(names)]
            session.commit()
            return len(runs)

    def delete_runs(self, run_ids: list[str]) -> list[str]:
        """Batch delete runs. Returns output_dir values whose artifacts the
        caller may remove from disk."""
        if not run_ids:
            raise RunServiceError("no runs selected")
        with self._sf() as session:
            runs = (
                session.scalars(select(Run).options(*_EAGER).where(Run.id.in_(run_ids)).options(*_EAGER)).unique().all()
            )
            missing = [rid for rid in run_ids if rid not in {r.id for r in runs}]
            if missing:
                raise KeyError(f"runs not found: {missing}")
            output_dirs = [r.output_dir for r in runs]
            for run in runs:
                session.delete(run)
            session.commit()
            return output_dirs

    def duplicate_run(self, run_id: str, new_output_dir: str) -> Run:
        """Copy a run's configuration into a new draft run."""
        with self._sf() as session:
            source = session.get(Run, run_id, options=_EAGER)
            if source is None:
                raise KeyError(f"run {run_id} not found")
            copy = Run(
                id=new_run_id(),
                label=f"{source.label} (copy)",
                output_dir=new_output_dir,
                n_runs=source.n_runs,
                max_evals=source.max_evals,
                alpha=source.alpha,
                seed_base=source.seed_base,
                status=RunStatus.DRAFT,
            )
            copy.algo_params = AlgoParamsRow(
                payload=source.algo_params.payload if source.algo_params else {}
            )
            copy.test_cases = [
                TestCaseSel(fname=tc.fname, dim=tc.dim) for tc in source.test_cases
            ]
            session.add(copy)
            session.commit()
            return copy
