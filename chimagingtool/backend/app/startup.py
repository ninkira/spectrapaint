"""Application startup tasks — run once when the server boots.

The key job is to create/upgrade the SQLite database to the latest schema WITHOUT the user
ever running a command. This is what lets the packaged app "just work", and lets a new
release migrate an existing user's database in place the first time they launch it.
"""
from alembic import command
from alembic.config import Config

from .paths import ALEMBIC_DIR, DATABASE_URL


def init_app() -> None:
    """Create the DB on first run and bring it to the latest schema (== `alembic upgrade head`)."""
    cfg = Config()
    cfg.set_main_option("script_location", str(ALEMBIC_DIR))
    cfg.set_main_option("sqlalchemy.url", DATABASE_URL)
    command.upgrade(cfg, "head")
