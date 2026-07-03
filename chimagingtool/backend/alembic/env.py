from logging.config import fileConfig
import sys
from pathlib import Path

from sqlalchemy import engine_from_config, pool

from alembic import context

# Make the backend/ directory importable so `app.*` resolves no matter where alembic runs.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.database import Base  # noqa: E402
from app.db import models  # noqa: E402,F401  (import registers tables on Base.metadata)
from app.paths import DATABASE_URL  # noqa: E402

# Alembic Config object (reads alembic.ini).
config = context.config

# Set up Python logging from the ini.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Use the same SQLite URL the app uses (per-user data folder), overriding alembic.ini.
config.set_main_option("sqlalchemy.url", DATABASE_URL)

# Target schema for --autogenerate.
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Generate SQL without a live DB connection."""
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,  # SQLite-safe ALTERs
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a live DB connection."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,  # SQLite-safe ALTERs
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
