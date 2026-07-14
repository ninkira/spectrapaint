"""upload metadata fields

Adds the metadata the user-driven upload modal captures:
  * DataAcquisition — illumination / environment / instrument / provenance fields.
  * HsiCube        — the remaining ENVI header fields read from the file on upload.
  * ExternalInput  — an optional link to a DataAcquisition (so non-HSI uploads can carry
                     the same capture-session metadata).

All columns are additive and nullable (booleans default to 0), so this is a safe in-place
upgrade for existing databases. SQLite ALTERs run in batch mode (see alembic/env.py).

Revision ID: c1a2b3d4e5f6
Revises: a01c09aafa63
Create Date: 2026-07-06 12:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1a2b3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'a01c09aafa63'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("data_acquisitions") as batch:
        batch.add_column(sa.Column("illumination_type", sa.String(), nullable=True))
        batch.add_column(sa.Column("illumination_source", sa.String(), nullable=True))
        batch.add_column(sa.Column("illumination_notes", sa.String(), nullable=True))
        batch.add_column(sa.Column("temperature", sa.Float(), nullable=True))
        batch.add_column(sa.Column("distance_to_object", sa.Float(), nullable=True))
        batch.add_column(sa.Column("instrument_position", sa.String(), nullable=True))
        batch.add_column(sa.Column("scan_duration", sa.Float(), nullable=True))
        batch.add_column(sa.Column("calibration_ref", sa.String(), nullable=True))
        batch.add_column(sa.Column("preprocessing_notes", sa.String(), nullable=True))
        batch.add_column(sa.Column("software_version", sa.String(), nullable=True))
        batch.add_column(sa.Column("operator", sa.String(), nullable=True))
        batch.add_column(
            sa.Column("exif_available", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch.add_column(
            sa.Column("envi_available", sa.Boolean(), nullable=False, server_default=sa.false())
        )

    with op.batch_alter_table("hsi_cubes") as batch:
        batch.add_column(sa.Column("default_bands", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("pixel_size", sa.Float(), nullable=True))
        batch.add_column(sa.Column("sensor_type", sa.String(), nullable=True))
        batch.add_column(sa.Column("description", sa.String(), nullable=True))
        batch.add_column(sa.Column("file_type", sa.String(), nullable=True))
        batch.add_column(sa.Column("header_offset", sa.Integer(), nullable=True))

    with op.batch_alter_table("external_inputs") as batch:
        batch.add_column(sa.Column("acquisition_id", sa.Uuid(), nullable=True))
        batch.create_foreign_key(
            "fk_external_inputs_acquisition_id",
            "data_acquisitions",
            ["acquisition_id"],
            ["acquisition_id"],
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("external_inputs") as batch:
        batch.drop_constraint("fk_external_inputs_acquisition_id", type_="foreignkey")
        batch.drop_column("acquisition_id")

    with op.batch_alter_table("hsi_cubes") as batch:
        batch.drop_column("header_offset")
        batch.drop_column("file_type")
        batch.drop_column("description")
        batch.drop_column("sensor_type")
        batch.drop_column("pixel_size")
        batch.drop_column("default_bands")

    with op.batch_alter_table("data_acquisitions") as batch:
        batch.drop_column("envi_available")
        batch.drop_column("exif_available")
        batch.drop_column("operator")
        batch.drop_column("software_version")
        batch.drop_column("preprocessing_notes")
        batch.drop_column("calibration_ref")
        batch.drop_column("scan_duration")
        batch.drop_column("instrument_position")
        batch.drop_column("distance_to_object")
        batch.drop_column("temperature")
        batch.drop_column("illumination_notes")
        batch.drop_column("illumination_source")
        batch.drop_column("illumination_type")
