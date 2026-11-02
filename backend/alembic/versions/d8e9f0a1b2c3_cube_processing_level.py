"""cube processing level and derivation link

Adds two columns to HsiCube so a reflectance cube can say where it came from:

* `processing_level` — "radiance" (as captured) or "reflectance" (flat-field corrected).
* `derived_from_dataset_id` — the app's string dataset id of the cube this one was computed
  from, a soft reference in the same style as ExternalInput.linked_dataset_id.

Both nullable: cubes uploaded before this migration carry no claim about their processing
level, which is honest — the app cannot tell by looking whether an existing cube is radiance
or reflectance.

Additive and nullable — safe in-place upgrade. SQLite ALTERs run in batch mode (see alembic/env.py).

Revision ID: d8e9f0a1b2c3
Revises: c7d8e9f0a1b2
Create Date: 2026-10-18 16:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd8e9f0a1b2c3'
down_revision: Union[str, Sequence[str], None] = 'c7d8e9f0a1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("hsi_cubes") as batch:
        batch.add_column(sa.Column("processing_level", sa.String(), nullable=True))
        batch.add_column(sa.Column("derived_from_dataset_id", sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("hsi_cubes") as batch:
        batch.drop_column("derived_from_dataset_id")
        batch.drop_column("processing_level")
