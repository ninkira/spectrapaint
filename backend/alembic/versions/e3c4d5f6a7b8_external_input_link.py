"""external input linked dataset

Adds `linked_dataset_id` to ExternalInput: the dataset a visual (PNG/TIFF/JPEG) belongs to or was
derived from — e.g. a PNG render linked to the HSI cube it came from. Stored as the app's string
dataset id (a soft reference), nullable.

Additive and nullable — safe in-place upgrade. SQLite ALTERs run in batch mode (see alembic/env.py).

Revision ID: e3c4d5f6a7b8
Revises: d2b3c4e5f6a7
Create Date: 2026-07-06 13:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e3c4d5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'd2b3c4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("external_inputs") as batch:
        batch.add_column(sa.Column("linked_dataset_id", sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("external_inputs") as batch:
        batch.drop_column("linked_dataset_id")
