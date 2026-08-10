"""dublin core metadata

Completes the descriptive metadata the data model specifies.

Project carries the selective Dublin Core subset that applies at project level — title, creator,
contributor, date and rights. Title and creator already existed.

Object (still the `artefacts` table at this revision; renamed in the next one) carries all 15 DC
elements describing the physical artefact, plus `object_pid` for an external persistent
identifier such as a Wikidata URI. UUID primary keys are globally unique but not web-resolvable,
so they are not persistent identifiers in the FAIR sense; this column is the bridge to an
authoritative external record.

`dc_type` is a Dublin Core element and is deliberately separate from the existing `object_type`,
which is the system's own painting/manuscript discriminator.

Every column is nullable — additive only, no table rebuild.

Revision ID: a5b6c7d8e9f0
Revises: f4d5e6a7b8c9
Create Date: 2026-08-06 15:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a5b6c7d8e9f0'
down_revision: Union[str, Sequence[str], None] = 'f4d5e6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_PROJECT_COLUMNS = ("dc_contributor", "dc_date", "dc_rights")

# dc_title and dc_description already exist on the table.
_OBJECT_COLUMNS = (
    "object_pid",
    "dc_creator",
    "dc_subject",
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


def upgrade() -> None:
    """Upgrade schema."""
    for column in _PROJECT_COLUMNS:
        op.add_column("projects", sa.Column(column, sa.String(), nullable=True))
    for column in _OBJECT_COLUMNS:
        op.add_column("artefacts", sa.Column(column, sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    for column in reversed(_OBJECT_COLUMNS):
        op.drop_column("artefacts", column)
    for column in reversed(_PROJECT_COLUMNS):
        op.drop_column("projects", column)
