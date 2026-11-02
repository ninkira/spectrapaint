"""cube reference captures

Adds `reference_refs` to HsiCube: the dark / white / white-dark captures a flat-field
correction consumed, as a JSON object of {role: data_ref}.

Those captures are stored on disk but are not datasets — they are inputs to the correction,
not images to view — so no registry record and no other row points at them. Without this
column, deleting the cubes they belong to left hundreds of megabytes per capture behind with
nothing in the app able to reach them. Recording them here is what lets `delete_dataset` drop
the files once the last cube that lists them is gone.

Nullable: every cube uploaded before this migration has no recorded references, which is also
true of every cube that was never flat-fielded.

Additive and nullable — safe in-place upgrade. SQLite ALTERs run in batch mode (see alembic/env.py).

Revision ID: e9f0a1b2c3d4
Revises: d8e9f0a1b2c3
Create Date: 2026-10-18 18:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e9f0a1b2c3d4'
down_revision: Union[str, Sequence[str], None] = 'd8e9f0a1b2c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("hsi_cubes") as batch:
        batch.add_column(sa.Column("reference_refs", sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("hsi_cubes") as batch:
        batch.drop_column("reference_refs")
