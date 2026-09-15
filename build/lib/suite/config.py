"""Suite application configuration loaded from environment / .env file.

No secrets are involved; this only holds filesystem paths and log level.
"""

import os
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_APP_DIR_NAME = "hyde-hygo-benchmark-suite"


def find_project_root(start: Path) -> Path | None:
    """Walk up from ``start`` until a directory containing ``pyproject.toml``.

    Returns ``None`` when the module is not part of a source checkout (e.g.
    an installed wheel inside site-packages), where relative-to-repo paths
    do not exist.
    """
    for parent in (start, *start.parents):
        if (parent / "pyproject.toml").is_file():
            return parent
    return None


def xdg_data_dir() -> Path:
    """Installed-app data directory following the XDG Base Directory spec."""
    data_home = os.environ.get("XDG_DATA_HOME")
    base = Path(data_home) if data_home else Path.home() / ".local" / "share"
    return base / _APP_DIR_NAME


def resolve_data_dir() -> Path:
    """Data directory used by the suite.

    Source checkouts store runs and the database under ``<repo>/data``
    (gitignored); installed/bundled builds fall back to the XDG user data
    dir because the package location is read-only and repo-relative paths
    do not exist there.
    """
    root = find_project_root(Path(__file__).resolve())
    if root is not None:
        return root / "data"
    return xdg_data_dir()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    suite_data_dir: Path = Field(default_factory=resolve_data_dir)
    log_level: str = "INFO"

    @property
    def db_path(self) -> Path:
        return self.suite_data_dir / "suite.db"

    @property
    def runs_dir(self) -> Path:
        return self.suite_data_dir / "runs"

    def ensure_dirs(self) -> None:
        self.suite_data_dir.mkdir(parents=True, exist_ok=True)
        self.runs_dir.mkdir(parents=True, exist_ok=True)


def get_settings() -> Settings:
    return Settings()
