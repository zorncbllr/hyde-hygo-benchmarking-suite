"""Pytauri application wiring: IPC commands, app builder, entry point.

This module imports ``pytauri`` and therefore only works inside the tauri
runtime (``tauri dev`` / ``tauri build`` via the Rust bootstrap, or a
``pytauri-wheel`` build). Keep business logic out of this module.
"""

from anyio.from_thread import start_blocking_portal
from pytauri import (
    Manager,
    builder_factory,
    context_factory,
)

from .commands import commands
from .config import get_settings
from .state import AppState


def main() -> int:
    """Run the tauri-app."""
    state = AppState(get_settings())
    with start_blocking_portal("asyncio") as portal:  # or `trio`
        app = builder_factory().build(
            context=context_factory(),
            invoke_handler=commands.generate_handler(portal),
        )
        Manager.manage(app, state)
        exit_code = app.run_return()
        return exit_code
