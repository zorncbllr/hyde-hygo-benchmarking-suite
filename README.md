# HyDE-HyGO Benchmarking Suite

A desktop benchmarking suite for the HyDE (bin/qub/con) and HyGO algorithm
family, built with [pytauri](https://pytauri.github.io/pytauri/) (Python
backend) and React + TypeScript + TailwindCSS + shadcn/ui (frontend).

Replaces the pure-terminal workflow with a live GUI while producing
**byte-identical results and exports** to the reference CLI implementation
in `~/Algorithms/hyde-hygo-benchmark-environment`, whose code is vendored
verbatim under `src/hyde_bench`.

## Features

The app has three pages:

- **Run**: experiment configuration (scenario selection, runs, eval budget,
  alpha, seeds, per-algorithm hyperparameters) with CLI-parity defaults.
  Starting a benchmark switches the page to the live monitor: progress, ETA,
  per-run table, live convergence charts, ranked per-algorithm stats and a
  3D preview (surface + live population point cloud for 2D scenarios, with a
  maximize button and a ranking dashboard for 25D scenarios), plus cancel
  and new-experiment controls.
- **Results**: the full run history (SQLite-backed, normalized schema,
  Alembic migrations) with search and status filters. Selecting a run opens
  its detail: scenario metric tables, convergence charts, cost box plots,
  3D replay of recorded runs, statistical analyses, per-artifact exports
  (generated through the reference implementation's own functions) and run
  management (rename, duplicate, delete, open output directory).
- **Simulation**: reserved for future interactive simulation features.

## Layout

```
src/hyde_bench/   vendored benchmark code (reference copy + progress_hook telemetry)
src/suite/        pytauri app (commands, runner, exports, telemetry)
  suite/db/       SQLAlchemy models, run service (CRUD + batch), zstd payloads
  suite/app.py    pytauri wiring (only pytauri-dependent module)
alembic/          migrations
src-tauri/        Rust bootstrap (pytauri standalone) + tauri config
ui/               React + TS + Tailwind v4 + shadcn/ui frontend
tests/            pytest suite (unit + integration + parity regression)
```

## Development

Requirements: Rust (cargo), Python 3.9+, [uv](https://docs.astral.sh/uv/),
[bun](https://bun.sh).

```bash
# Python environment
uv venv --python-preference only-system
uv pip install -e .
uv pip install pytest ruff

# Frontend
cd ui && bun install

# Run the desktop app (dev mode, hot reload)
source .venv/bin/activate
cd ui && bun run tauri dev
```

## Testing and verification

```bash
# Python
.venv/bin/python -m pytest tests/
.venv/bin/ruff check src tests alembic

# Frontend
cd ui
bun run verify   # typecheck + vitest
bun run lint     # eslint + prettier
bun run build    # production build
```

### Parity guarantee

- `tests/test_parity_app_vs_cli.py` asserts that a benchmark executed through
  the app's worker produces a `benchmark_results.json` identical to a direct
  CLI-loop run (same scenario order, seeding scheme and algorithm kwargs).
- The vendored algorithms accept an optional `progress_hook`; with `None`
  (the default) behavior is byte-identical to the reference implementation.
- Exports call `hyde_bench.run_benchmark`'s own `save_*` / `make_*` /
  `generate_docx_report` functions with the module output constants
  redirected to the run directory, so artifact contents match a CLI run.

## Packaging

```bash
source .venv/bin/activate
cd ui && bun run tauri build
```

This bundles the standalone Rust binary with an embedded Python
distribution. See the pytauri "Build Standalone Binary" tutorial for
platform-specific options.

## Configuration

Copy `.env.example` to `.env`:

- `SUITE_DATA_DIR`: root for the database, run artifacts and exports
  (default: `<repo>/data`).
- `LOG_LEVEL`: application log level.
