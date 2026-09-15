"""The HyDE-HyGO Benchmarking Suite pytauri app.

Only this module (and ``__main__``) depends on ``pytauri``: it cannot be
imported outside the tauri runtime because ``pytauri`` eagerly resolves its
extension module. All business logic lives in pytauri-free submodules
(``runner``, ``db``, ``exports``, ``telemetry``, ``schemas``) so it stays
unit- and integration-testable with plain pytest.
"""
