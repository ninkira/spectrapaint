"""roi external input link

An ROI targets exactly one source: an HSI Cube or an External Input. Only the cube link existed,
so an annotation on an XRF map or an RGB photograph was attached to nothing relationally — the
tie was the loose `dataset_id` string. That made the model's cross-modal claim untrue in the one
place it should have been visible.

Backfilled by joining `roi_annotations.dataset_id` to `external_inputs.dataset_id`, which the
`dataset_identity` migration made available as a stored column.

The CHECK is `<= 1`, not `= 1`. Rows with neither link already exist: `_build_roi_row` leaves
cube_id NULL whenever the dataset is not in the database at save time. Tightening to exactly-one
requires the PUT endpoint to reject an unresolvable dataset first, which is a behaviour change
and belongs in its own revision.

Revision ID: c7d8e9f0a1b2
Revises: b6c7d8e9f0a1
Create Date: 2026-08-06 15:35:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7d8e9f0a1b2'
down_revision: Union[str, Sequence[str], None] = 'b6c7d8e9f0a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _roi_table(with_external: bool) -> sa.Table:
    """`roi_annotations` as batch mode should rebuild it."""
    columns = [
        sa.Column("roi_id", sa.Uuid(), primary_key=True),
        sa.Column("selector_type", sa.String(), nullable=False),
        sa.Column("selector_value", sa.String(), nullable=False),
        sa.Column("target", sa.String(), nullable=False),
        sa.Column("body", sa.String(), nullable=True),
        sa.Column("body_format", sa.String(), nullable=True),
        sa.Column("motivation", sa.String(), nullable=False),
        sa.Column("creator", sa.String(), nullable=True),
        sa.Column("created", sa.DateTime(), nullable=False),
        sa.Column("modified", sa.DateTime(), nullable=True),
        sa.Column("generator", sa.String(), nullable=True),
        sa.Column("generated", sa.DateTime(), nullable=True),
        sa.Column("dataset_id", sa.String(), nullable=True),
        sa.Column("cube_id", sa.Uuid(), nullable=True),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["cube_id"], ["hsi_cubes.cube_id"]),
    ]
    if with_external:
        columns.insert(-2, sa.Column("external_input_id", sa.Uuid(), nullable=True))
        columns.append(
            sa.ForeignKeyConstraint(["external_input_id"], ["external_inputs.input_id"])
        )
        columns.append(
            sa.CheckConstraint(
                "((cube_id IS NOT NULL) + (external_input_id IS NOT NULL)) <= 1",
                name="ck_roi_annotations_single_source",
            )
        )
    return sa.Table("roi_annotations", sa.MetaData(), *columns)


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("roi_annotations", sa.Column("external_input_id", sa.Uuid(), nullable=True))

    # Link annotations on raster inputs, and give them the same urn:uuid target form cube
    # annotations already use.
    op.execute(
        """
        UPDATE roi_annotations
           SET external_input_id = (
                   SELECT e.input_id FROM external_inputs e
                    WHERE e.dataset_id = roi_annotations.dataset_id
               )
         WHERE cube_id IS NULL
           AND dataset_id IN (SELECT dataset_id FROM external_inputs WHERE dataset_id IS NOT NULL)
        """
    )
    op.execute(
        """
        UPDATE roi_annotations
           SET target = 'urn:uuid:' || external_input_id
         WHERE external_input_id IS NOT NULL
        """
    )

    # The foreign key and the CHECK have to be added by rebuilding the table; SQLite cannot
    # attach either in place.
    with op.batch_alter_table(
        "roi_annotations", copy_from=_roi_table(with_external=True), recreate="always"
    ):
        pass


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table(
        "roi_annotations", copy_from=_roi_table(with_external=False), recreate="always"
    ):
        pass
    # Recreating from the definition above already drops the column, but be explicit if it
    # survived on a dialect that supports in-place ALTER.
    if "external_input_id" in {
        c["name"] for c in sa.inspect(op.get_bind()).get_columns("roi_annotations")
    }:
        op.drop_column("roi_annotations", "external_input_id")
