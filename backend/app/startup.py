"""Application startup tasks — run once when the server boots.

The key job is to create/upgrade the SQLite database to the latest schema WITHOUT the user
ever running a command. This is what lets the packaged app "just work", and lets a new
release migrate an existing user's database in place the first time they launch it.
"""
from alembic import command
from alembic.config import Config

from .paths import ALEMBIC_DIR, DATABASE_URL


def init_app() -> None:
    """Create/upgrade the DB to the latest schema on startup.

    The app is upload-driven: datasets are registered when the user uploads them through the Data
    Manager modal (file bytes + DB row), not by scanning the filesystem. So there is no dataset
    sync here — the DB is the single source of truth for what the app shows.
    """
    cfg = Config()
    cfg.set_main_option("script_location", str(ALEMBIC_DIR))
    cfg.set_main_option("sqlalchemy.url", DATABASE_URL)
    command.upgrade(cfg, "head")
