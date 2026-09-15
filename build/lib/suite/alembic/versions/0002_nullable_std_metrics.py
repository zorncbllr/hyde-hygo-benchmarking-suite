"""nullable std metrics (nan with single-run experiments)

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-29
"""

from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("scenario_results") as batch:
        batch.alter_column("std_best", existing_type=sa.Float(), nullable=True)
        batch.alter_column(
            "std_obj_error", existing_type=sa.Float(), nullable=True
        )
        batch.alter_column("std_auc", existing_type=sa.Float(), nullable=True)


def downgrade() -> None:
    with op.batch_alter_table("scenario_results") as batch:
        batch.alter_column("std_auc", existing_type=sa.Float(), nullable=False)
        batch.alter_column(
            "std_obj_error", existing_type=sa.Float(), nullable=False
        )
        batch.alter_column("std_best", existing_type=sa.Float(), nullable=False)
