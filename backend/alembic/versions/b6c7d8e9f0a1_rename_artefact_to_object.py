"""rename artefact to object

The data model names this entity Object (edm:ProvidedCHO); the code called it Artefact. Someone
reading the published figure alongside the repository should find the same word in both.

Mechanics: SQLite cannot rename a column or repoint a foreign key in place, so
`data_acquisitions` is rebuilt in batch mode. `copy_from` passes an explicit table definition
rather than letting Alembic reflect one, because reflection of the unnamed foreign keys the
first migration created is unreliable — that is also why the naming convention landed first.

The `objects` table is created and populated with INSERT ... SELECT rather than renamed, so the
new foreign key is named by the convention instead of inheriting the old unnamed one.

Revision ID: b6c7d8e9f0a1
Revises: a5b6c7d8e9f0
Create Date: 2026-08-06 15:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b6c7d8e9f0a1'
down_revision: Union[str, Sequence[str], None] = 'a5b6c7d8e9f0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Columns carried across, in a fixed order so the INSERT ... SELECT lines up.
_CARRIED = (
    "project_id",
    "object_type",
    "object_pid",
    "created_at",
    "dc_title",
    "dc_creator",
    "dc_subject",
    "dc_description",
    "dc_publisher",
    "dc_contributor",
    "dc_date",
    "dc_type",
    "dc_format",
    "dc_identifier",
    "dc_source",
    "dc_language",
    "dc_relation",
    "dc_coverage",
    "dc_rights",
)


def _acquisitions_table(fk_column: str, fk_target: str) -> sa.Table:
    """The shape of `data_acquisitions`, for batch mode's copy_from.

    Only the primary key and the foreign key under change need to be accurate; the remaining
    columns are declared so the rebuild preserves them.
    """
    return sa.Table(
        "data_acquisitions",
        sa.MetaData(),
        sa.Column("acquisition_id", sa.Uuid(), primary_key=True),
        sa.Column(fk_column, sa.Uuid(), nullable=False),
        sa.Column("capture_modality", sa.String(), nullable=False),
        sa.Column("captured_at", sa.DateTime(), nullable=True),
        sa.Column("instrument_id", sa.String(), nullable=True),
        sa.Column("instrument_settings", sa.JSON(), nullable=True),
        sa.Column("illumination_type", sa.String(), nullable=True),
        sa.Column("illumination_source", sa.String(), nullable=True),
        sa.Column("illumination_notes", sa.String(), nullable=True),
        sa.Column("temperature", sa.Float(), nullable=True),
        sa.Column("distance_to_object", sa.Float(), nullable=True),
        sa.Column("instrument_position", sa.String(), nullable=True),
        sa.Column("scan_duration", sa.Float(), nullable=True),
        sa.Column("dark_reference", sa.Boolean(), nullable=False),
        sa.Column("white_reference", sa.Boolean(), nullable=False),
        sa.Column("calibration_ref", sa.String(), nullable=True),
        sa.Column("preprocessing_notes", sa.String(), nullable=True),
        sa.Column("software_version", sa.String(), nullable=True),
        sa.Column("operator", sa.String(), nullable=True),
        sa.Column("exif_available", sa.Boolean(), nullable=False),
        sa.Column("envi_available", sa.Boolean(), nullable=False),
        sa.Column("notes", sa.String(), nullable=True),
        sa.ForeignKeyConstraint([fk_column], [fk_target]),
    )


def _move(old_table: str, new_table: str, old_pk: str, new_pk: str,
          fk_from: str, fk_to: str, acq_target: str) -> None:
    op.create_table(
        new_table,
        sa.Column(new_pk, sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("object_type", sa.String(), nullable=False),
        sa.Column("object_pid", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        *(sa.Column(c, sa.String(), nullable=(c != "dc_title"))
          for c in _CARRIED if c.startswith("dc_")),
        sa.ForeignKeyConstraint(["project_id"], ["projects.project_id"]),
        sa.PrimaryKeyConstraint(new_pk),
    )
    columns = ", ".join((new_pk, *_CARRIED))
    source = ", ".join((old_pk, *_CARRIED))
    op.execute(f"INSERT INTO {new_table} ({columns}) SELECT {source} FROM {old_table}")

    with op.batch_alter_table(
        "data_acquisitions", copy_from=_acquisitions_table(fk_from, f"{old_table}.{old_pk}")
    ) as batch:
        batch.alter_column(fk_from, new_column_name=fk_to)

    # The rename above carries the old foreign key across under the new column name, still
    # pointing at the table about to be dropped. `recreate="always"` is required: batch mode
    # only rebuilds when there is an operation to perform, so without it this block is a no-op
    # and `data_acquisitions` is left referencing a table that no longer exists — which SQLite
    # accepts silently until the next write, then fails with "no such table".
    with op.batch_alter_table(
        "data_acquisitions",
        copy_from=_acquisitions_table(fk_to, acq_target),
        recreate="always",
    ):
        pass

    op.drop_table(old_table)


def upgrade() -> None:
    """Upgrade schema."""
    _move("artefacts", "objects", "artefact_id", "object_id",
          "artefact_id", "object_id", "objects.object_id")


def downgrade() -> None:
    """Downgrade schema."""
    _move("objects", "artefacts", "object_id", "artefact_id",
          "object_id", "artefact_id", "artefacts.artefact_id")
