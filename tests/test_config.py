"""Tests for suite.config settings loading."""

from suite.config import Settings


def test_defaults():
    settings = Settings(_env_file=None)
    assert settings.log_level == "INFO"
    assert settings.suite_data_dir.name == "data"
    assert settings.db_path.name == "suite.db"
    assert settings.runs_dir.name == "runs"
