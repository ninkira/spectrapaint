"""dataset identity

Stores the app's string dataset id on `hsi_cubes` and `external_inputs` instead of recomputing
it from `data_ref` on every registry build.

Why this matters: `stable_id("cube", dataset_id)` derives each row's UUID primary key from that
string, so the derivation and the stored keys are welded together. Change the path scheme —
which the multi-project work must do, since today it strips a hardcoded "old_man" prefix — and
the lookups silently return None. Annotations lose their cube link, DELETE stops deleting, and
/db-meta returns empty, all without raising. Storing the id makes it a fact rather than a
computation.

The derivation below is a FROZEN COPY of app.services.dataset_store as of this revision. It is
deliberately duplicated rather than imported: a later refactor of that module must not be able
to retroactively change what this backfill produced.

`title` is backfilled from the same module's `_default_name()` where NULL, because that fallback
embeds the hardcoded project name ("Old Man"). Without this, every legacy dataset's display name
would change the moment the hardcoding goes.

Additive and nullable — safe in-place upgrade, no table rebuild, so no constraint reflection.

Revision ID: f4d5e6a7b8c9
Revises: e3c4d5f6a7b8
Create Date: 2026-08-06 12:30:00.000000

"""
import re
from pathlib import PurePosixPath
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f4d5e6a7b8c9'
down_revision: Union[str, Sequence[str], None] = 'e3c4d5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# --- frozen copy of the id/name derivation (see module docstring) --------------------------

PROJECT_ID = "old_man"


def _to_title(text: str) -> str:
    clean = re.sub(r"[_\-]+", " ", text).strip()
    return clean.title() if clean else text


PROJECT_NAME = _to_title(PROJECT_ID)


def _dataset_id_from_data_ref(data_ref: str) -> str:
    """e.g. "old_man/hsi/raw/001.hdr" -> "hsi__raw__001"."""
    rel = PurePosixPath(data_ref)
    parts = rel.parts
    if parts and parts[0] == PROJECT_ID:
        rel = PurePosixPath(*parts[1:])
    return rel.with_suffix("").as_posix().replace("/", "__")


def _default_name(data_ref: str) -> str:
    return f"{PROJECT_NAME} - {_to_title(PurePosixPath(data_ref).stem)}"


# --- migration ------------------------------------------------------------------------------

_TABLES = (("hsi_cubes", "cube_id"), ("external_inputs", "input_id"))


def upgrade() -> None:
    """Upgrade schema."""
    conn = op.get_bind()

    for table, _pk in _TABLES:
        op.add_column(table, sa.Column("dataset_id", sa.String(), nullable=True))

    for table, pk in _TABLES:
        rows = conn.execute(sa.text(f"SELECT {pk}, data_ref, title FROM {table}")).fetchall()
        seen: dict[str, object] = {}
        for key, data_ref, title in rows:
            dataset_id = _dataset_id_from_data_ref(data_ref)
            if dataset_id in seen:
                # Two rows in one table deriving the same id means the registry was already
                # dropping one of them (dict key collision). Leave the later row's id NULL so
                # the unique index can still be created, rather than failing the upgrade and
                # leaving the user unable to start the app.
                continue
            seen[dataset_id] = key
            conn.execute(
                sa.text(
                    f"UPDATE {table} SET dataset_id = :dataset_id, title = :title WHERE {pk} = :pk"
                ),
                {"dataset_id": dataset_id, "title": title or _default_name(data_ref), "pk": key},
            )

    for table, _pk in _TABLES:
        op.create_index(f"ix_{table}_dataset_id", table, ["dataset_id"], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    for table, _pk in _TABLES:
        op.drop_index(f"ix_{table}_dataset_id", table_name=table)
        op.drop_column(table, "dataset_id")
