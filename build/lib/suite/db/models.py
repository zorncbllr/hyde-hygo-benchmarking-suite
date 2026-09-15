"""SQLAlchemy ORM models for the suite database.

Normalized (~3NF): run configuration, test-case selection and per-scenario
metrics are separate relations; heavy per-scenario arrays (raw costs, curves)
live in zstd-compressed files referenced by ``payloads_path``.
"""

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_run_id() -> str:
    return uuid.uuid4().hex


class Base(DeclarativeBase):
    pass


class RunStatus(str, enum.Enum):
    DRAFT = "draft"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow
    )
    label: Mapped[str] = mapped_column(String(256))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[RunStatus] = mapped_column(String(16), default=RunStatus.DRAFT)
    duration_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    output_dir: Mapped[str] = mapped_column(String(1024))
    seed_base: Mapped[int] = mapped_column(Integer, default=0)
    n_runs: Mapped[int] = mapped_column(Integer)
    max_evals: Mapped[int] = mapped_column(Integer)
    alpha: Mapped[float] = mapped_column(Float)

    algo_params: Mapped["AlgoParamsRow | None"] = relationship(
        back_populates="run", uselist=False, cascade="all, delete-orphan"
    )
    test_cases: Mapped[list["TestCaseSel"]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )
    scenario_results: Mapped[list["ScenarioResult"]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )
    tags: Mapped[list["Tag"]] = relationship(
        secondary="run_tags", back_populates="runs"
    )

    __table_args__ = (Index("ix_runs_status_created", "status", "created_at"),)


class AlgoParamsRow(Base):
    """Per-run algorithm hyperparameters (one JSON document, 1:1 with run)."""

    __tablename__ = "algo_params"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"), unique=True
    )
    payload: Mapped[dict] = mapped_column(JSON)

    run: Mapped[Run] = relationship(back_populates="algo_params")


class TestCaseSel(Base):
    """Normalized (fname, dim) scenario selection per run."""

    __tablename__ = "test_case_sel"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"))
    fname: Mapped[str] = mapped_column(String(64))
    dim: Mapped[int] = mapped_column(Integer)

    run: Mapped[Run] = relationship(back_populates="test_cases")

    __table_args__ = (
        UniqueConstraint("run_id", "fname", "dim", name="uq_test_case_sel"),
    )


class ScenarioResult(Base):
    """Per-(scenario, algorithm) summary metrics for a run.

    Metric columns mirror ``hyde_bench.run_benchmark.summarize`` output so
    history filtering and run comparison stay in SQL. Heavy arrays live on
    disk, path-referenced.
    """

    __tablename__ = "scenario_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"))
    fname: Mapped[str] = mapped_column(String(64))
    dim: Mapped[int] = mapped_column(Integer)
    algo_key: Mapped[str] = mapped_column(String(16))

    conv_pct: Mapped[float] = mapped_column(Float)
    # Metric columns are nullable: derived metrics (std, cv, ...) are
    # mathematically undefined for single-run or degenerate experiments;
    # the service layer sanitizes non-finite values to NULL.
    mean_best: Mapped[float | None] = mapped_column(Float, nullable=True)
    median_best: Mapped[float | None] = mapped_column(Float, nullable=True)
    std_best: Mapped[float | None] = mapped_column(Float, nullable=True)
    min_best: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_best: Mapped[float | None] = mapped_column(Float, nullable=True)
    iqr_best: Mapped[float | None] = mapped_column(Float, nullable=True)
    cv: Mapped[float | None] = mapped_column(Float, nullable=True)
    mean_obj_error: Mapped[float | None] = mapped_column(Float, nullable=True)
    std_obj_error: Mapped[float | None] = mapped_column(Float, nullable=True)
    mean_conv_gen: Mapped[float | None] = mapped_column(Float, nullable=True)
    mean_auc: Mapped[float | None] = mapped_column(Float, nullable=True)
    std_auc: Mapped[float | None] = mapped_column(Float, nullable=True)
    mean_evals: Mapped[float | None] = mapped_column(Float, nullable=True)
    mean_wall_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    median_wall_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    evals_per_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    converged_all: Mapped[bool] = mapped_column(Boolean, default=False)

    payloads_path: Mapped[str] = mapped_column(String(1024))

    run: Mapped[Run] = relationship(back_populates="scenario_results")

    __table_args__ = (
        UniqueConstraint("run_id", "fname", "dim", "algo_key", name="uq_scenario_result"),
        Index("ix_scenario_results_fname_dim", "fname", "dim"),
    )


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), unique=True)

    runs: Mapped[list[Run]] = relationship(
        secondary="run_tags", back_populates="tags"
    )


class RunTag(Base):
    __tablename__ = "run_tags"

    run_id: Mapped[str] = mapped_column(
        ForeignKey("runs.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[int] = mapped_column(
        ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True
    )
