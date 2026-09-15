"""Tests for suite.config settings loading."""

from pathlib import Path

import pytest

import suite.config as config_module
from suite.config import (
    _APP_DIR_NAME,
    Settings,
    find_project_root,
    resolve_data_dir,
)


def test_defaults():
    settings = Settings(_env_file=None)
    assert settings.log_level == "INFO"
    assert settings.db_path.name == "suite.db"
    assert settings.runs_dir.name == "runs"


def test_resolve_data_dir_source_checkout():
    """Inside a source checkout the data dir is <repo>/data."""
    repo_root = find_project_root(Path(__file__).resolve())
    assert repo_root is not None
    assert (repo_root / "pyproject.toml").is_file()
    assert resolve_data_dir() == repo_root / "data"


def test_find_project_root_walks_up(tmp_path: Path):
    root = tmp_path / "proj"
    pkg = root / "src" / "suite"
    pkg.mkdir(parents=True)
    assert find_project_root(pkg) is None

    (root / "pyproject.toml").touch()
    assert find_project_root(pkg) == root
    assert find_project_root(root / "src") == root


def test_resolve_data_dir_installed_falls_back_to_xdg(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """Without a source layout, data goes to the XDG user data dir."""
    monkeypatch.setattr(config_module, "find_project_root", lambda _start: None)
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "xdg"))
    assert resolve_data_dir() == tmp_path / "xdg" / _APP_DIR_NAME


def test_resolve_data_dir_xdg_default_home(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(config_module, "find_project_root", lambda _start: None)
    monkeypatch.delenv("XDG_DATA_HOME", raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))
    assert resolve_data_dir() == tmp_path / ".local" / "share" / _APP_DIR_NAME


def test_settings_env_override(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUITE_DATA_DIR", str(tmp_path / "custom"))
    settings = Settings(_env_file=None)
    assert settings.suite_data_dir == tmp_path / "custom"
    settings.ensure_dirs()
    assert (tmp_path / "custom" / "runs").is_dir()
