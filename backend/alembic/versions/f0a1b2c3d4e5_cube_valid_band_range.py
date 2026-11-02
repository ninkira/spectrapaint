"""cube valid band range

Adds `valid_band_min` / `valid_band_max` to HsiCube: the inclusive band-index range whose
spectra are worth comparing.

A VNIR detector is blind at both ends of its nominal range, where the lamp output and the
sensor's quantum efficiency fall away together. The flat-field denominator goes with them, so
the correction divides noise by noise and produces reflectance above 1.0 — impossible for a
diffuse surface, and (being the largest numbers in the spectrum) enough on their own to decide
a pigment ranking. Recording the usable range is what lets classification drop those bands
before computing a distance, and the plot shade them instead of hiding them.

Nullable, and independently so: a cube uploaded before this migration has no range, nor has one
imported already-corrected — it arrives with no reference captures to derive a range from, and
is expected to be given one by hand. Half a range (one bound set, the other open) is meaningful
and is honoured as such.

Additive and nullable — safe in-place upgrade. SQLite ALTERs run in batch mode (see alembic/env.py).

Revision ID: f0a1b2c3d4e5
Revises: e9f0a1b2c3d4
Create Date: 2026-10-18 20:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f0a1b2c3d4e5'
down_revision: Union[str, Sequence[str], None] = 'e9f0a1b2c3d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("hsi_cubes") as batch:
        batch.add_column(sa.Column("valid_band_min", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("valid_band_max", sa.Integer(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("hsi_cubes") as batch:
        batch.drop_column("valid_band_max")
        batch.drop_column("valid_band_min")
