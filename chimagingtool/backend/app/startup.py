"""Application startup tasks — run once when the server boots.

The key job is to create/upgrade the SQLite database to the latest schema WITHOUT the user
ever running a command. This is what lets the packaged app "just work", and lets a new
release migrate an existing user's database in place the first time they launch it.
"""
import logging

from alembic import command
from alembic.config import Config

from .paths import ALEMBIC_DIR, DATABASE_URL

logger = logging.getLogger(__name__)


def init_app() -> None:
    """Create/upgrade the DB, then sync the on-disk datasets into it — all on startup."""
    cfg = Config()
    cfg.set_main_option("script_location", str(ALEMBIC_DIR))
    cfg.set_main_option("sqlalchemy.url", DATABASE_URL)
    command.upgrade(cfg, "head")

    # Populate the backbone (Project/Artefact/HsiCube/ExternalInput) from the filesystem.
    # Best-effort: never let a sync problem stop the app from starting.
    from .db.database import SessionLocal
    from .services.dataset_sync import sync_datasets_to_db
    try:
        with SessionLocal() as db:
            sync_datasets_to_db(db)
    except Exception:
        logger.exception("Dataset sync failed; continuing without it")
