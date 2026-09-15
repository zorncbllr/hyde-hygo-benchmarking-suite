"""Artifact-directory deletion helpers.

``shutil.rmtree`` on an arbitrary configured path is dangerous: a run's
``output_dir`` may point anywhere (e.g. a run imported from the CLI or a
misconfigured setting). The app only ever creates run directories under
``Settings.runs_dir``, so artifact deletion is restricted to paths inside
that root; anything else must be reported instead of silently removed.
"""

from __future__ import annotations

from pathlib import Path


def split_deletable_artifact_dirs(
    output_dirs: list[str], runs_dir: Path
) -> tuple[list[str], list[str]]:
    """Split run ``output_dir`` values into (deletable, skipped).

    A directory is deletable only when it resolves inside ``runs_dir`` and
    is not the runs root itself (or one of its ancestors). ``Path.is_relative_to``
    handles lexical containment; a resolved symlink inside ``runs_dir``
    pointing elsewhere is rejected.
    """
    runs_root = runs_dir.resolve()
    deletable: list[str] = []
    skipped: list[str] = []
    for raw in output_dirs:
        path = Path(raw).resolve()
        if path != runs_root and path.is_relative_to(runs_root):
            deletable.append(raw)
        else:
            skipped.append(raw)
    return deletable, skipped
