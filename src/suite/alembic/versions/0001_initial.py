"""initial schema: runs, algo_params, test_case_sel, scenario_results, tags, run_tags

Revision ID: 0001
Revises:
Create Date: 2026-08-29
"""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("label", sa.String(256), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("duration_s", sa.Float(), nullable=True),
        sa.Column("output_dir", sa.String(1024), nullable=False),
        sa.Column("seed_base", sa.Integer(), nullable=False),
        sa.Column("n_runs", sa.Integer(), nullable=False),
        sa.Column("max_evals", sa.Integer(), nullable=False),
        sa.Column("alpha", sa.Float(), nullable=False),
    )
    op.create_index("ix_runs_status_created", "runs", ["status", "created_at"])

    op.create_table(
        "algo_params",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "run_id", sa.String(36), sa.ForeignKey("runs.id", ondelete="CASCADE"),
            nullable=False, unique=True,
        ),
        sa.Column("payload", sa.JSON(), nullable=False),
    )

    op.create_table(
        "test_case_sel",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "run_id", sa.String(36), sa.ForeignKey("runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("fname", sa.String(64), nullable=False),
        sa.Column("dim", sa.Integer(), nullable=False),
        sa.UniqueConstraint("run_id", "fname", "dim", name="uq_test_case_sel"),
    )

    op.create_table(
        "scenario_results",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "run_id", sa.String(36), sa.ForeignKey("runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("fname", sa.String(64), nullable=False),
        sa.Column("dim", sa.Integer(), nullable=False),
        sa.Column("algo_key", sa.String(16), nullable=False),
        sa.Column("conv_pct", sa.Float(), nullable=False),
        sa.Column("mean_best", sa.Float(), nullable=False),
        sa.Column("median_best", sa.Float(), nullable=False),
        sa.Column("std_best", sa.Float(), nullable=False),
        sa.Column("min_best", sa.Float(), nullable=False),
        sa.Column("max_best", sa.Float(), nullable=False),
        sa.Column("iqr_best", sa.Float(), nullable=False),
        sa.Column("cv", sa.Float(), nullable=False),
        sa.Column("mean_obj_error", sa.Float(), nullable=False),
        sa.Column("std_obj_error", sa.Float(), nullable=False),
        sa.Column("mean_conv_gen", sa.Float(), nullable=True),
        sa.Column("mean_auc", sa.Float(), nullable=False),
        sa.Column("std_auc", sa.Float(), nullable=False),
        sa.Column("mean_evals", sa.Float(), nullable=False),
        sa.Column("mean_wall_ms", sa.Float(), nullable=False),
        sa.Column("median_wall_ms", sa.Float(), nullable=False),
        sa.Column("evals_per_ms", sa.Float(), nullable=False),
        sa.Column("converged_all", sa.Boolean(), nullable=False),
        sa.Column("payloads_path", sa.String(1024), nullable=False),
        sa.UniqueConstraint(
            "run_id", "fname", "dim", "algo_key", name="uq_scenario_result"
        ),
    )
    op.create_index(
        "ix_scenario_results_fname_dim", "scenario_results", ["fname", "dim"]
    )

    op.create_table(
        "tags",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(64), nullable=False, unique=True),
    )

    op.create_table(
        "run_tags",
        sa.Column(
            "run_id", sa.String(36), sa.ForeignKey("runs.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "tag_id", sa.Integer(), sa.ForeignKey("tags.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )


def downgrade() -> None:
    op.drop_table("run_tags")
    op.drop_table("tags")
    op.drop_index("ix_scenario_results_fname_dim", table_name="scenario_results")
    op.drop_table("scenario_results")
    op.drop_table("test_case_sel")
    op.drop_table("algo_params")
    op.drop_index("ix_runs_status_created", table_name="runs")
    op.drop_table("runs")
