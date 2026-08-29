"""Suite application configuration loaded from environment / .env file.

No secrets are involved; this only holds filesystem paths and log level.
"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    suite_data_dir: Path = PROJECT_ROOT / "data"
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
