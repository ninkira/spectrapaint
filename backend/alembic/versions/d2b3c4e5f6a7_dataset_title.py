"""dataset title/label

Adds a user-facing display label (`title`) to HsiCube and ExternalInput. It is what the upload
modal makes the user enter; the registry uses it as the dataset name (falling back to a
filename-derived name for older rows that predate this column).

Additive and nullable — safe in-place upgrade. SQLite ALTERs run in batch mode (see alembic/env.py).

Revision ID: d2b3c4e5f6a7
Revises: c1a2b3d4e5f6
Create Date: 2026-07-06 13:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd2b3c4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'c1a2b3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("hsi_cubes") as batch:
        batch.add_column(sa.Column("title", sa.String(), nullable=True))
    with op.batch_alter_table("external_inputs") as batch:
        batch.add_column(sa.Column("title", sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("external_inputs") as batch:
        batch.drop_column("title")
    with op.batch_alter_table("hsi_cubes") as batch:
        batch.drop_column("title")
