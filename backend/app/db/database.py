"""Database engine, session factory, and the FastAPI DB dependency.

The connection string comes from app.paths.DATABASE_URL, which points at a SQLite file in
the per-user data folder (so it is writable even when the app is installed read-only).
"""
from collections.abc import Iterator

from sqlalchemy import MetaData, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from ..paths import DATABASE_URL

# Deterministic constraint names. SQLite cannot ALTER a constraint, so Alembic rebuilds the whole
# table in "batch" mode — and it can only drop or recreate a constraint that has a name. The
# earliest migrations created unnamed foreign keys, which is why renaming a table they point at
# fails with "Constraint must have a name". Everything created from here on is named, so future
# schema changes stay possible.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

# SQLite needs check_same_thread=False so the connection can be shared across the threads
# FastAPI uses for sync endpoints. (No-op for other databases.)
_is_sqlite = DATABASE_URL.startswith("sqlite")
connect_args = {"check_same_thread": False} if _is_sqlite else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)

# SQLite does not enforce foreign keys unless asked to, per-connection.
if _is_sqlite:
    @event.listens_for(engine, "connect")
    def _enable_sqlite_fk(dbapi_connection, _connection_record):  # noqa: ANN001
        cur = dbapi_connection.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    """Base class every ORM model inherits from; carries the shared metadata."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def get_db() -> Iterator[Session]:
    """FastAPI dependency: yield a session and always close it.

    Usage:  def endpoint(db: Session = Depends(get_db)): ...
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
