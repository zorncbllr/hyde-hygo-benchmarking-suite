"""all derived metric columns nullable (nan-safe with single-run experiments)

Any metric computed from a std (cv, std_*) or from degenerate data may be
undefined (nan) and is sanitized to NULL by the service layer.

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-29
"""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_METRIC_COLUMNS = (
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


def upgrade() -> None:
    with op.batch_alter_table("scenario_results") as batch:
        for col in _METRIC_COLUMNS:
            batch.alter_column(col, existing_type=sa.Float(), nullable=True)


def downgrade() -> None:
    with op.batch_alter_table("scenario_results") as batch:
        for col in _METRIC_COLUMNS:
            batch.alter_column(col, existing_type=sa.Float(), nullable=False)
