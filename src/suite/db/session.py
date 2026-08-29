"""Database engine, session factory and migration bootstrap."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from alembic.config import Config
from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from alembic import command

_ALEMBIC_DIR = Path(__file__).resolve().parents[3] / "alembic"


def make_engine(db_path: Path) -> Engine:
    """Create a SQLite engine with the pragmas suited for a desktop app."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def _set_pragma(dbapi_conn: sqlite3.Connection, _record) -> None:  # noqa: ANN001
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()

    return engine


def run_migrations(engine: Engine, db_path: Path) -> None:
    """Apply Alembic migrations up to head (no-op when already current)."""
    cfg = Config(str(_ALEMBIC_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(_ALEMBIC_DIR))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    cfg.attributes["configure_engine"] = engine
    command.upgrade(cfg, "head")


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False)
