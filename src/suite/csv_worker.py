"""Clean-subprocess per-run CSV writer.

The CSV export stage re-derives per-run CSVs from every stored payload
(~17MB zstd, ~2.5M parsed floats each). Parsing those blobs with stdlib
json does not scale with threads (GIL-bound), so the payload manifest is
processed here, in a fresh single-threaded interpreter, by its own
process pool. Input is the same style of JSON spec ``suite.exports``
writes for ``suite.chart_worker``; the result is a JSON line on stdout:
``{"failures": [...]}``.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

CSV_POOL_SIZE = 8


def _init_worker(csv_dir: str) -> None:
    import hyde_bench.run_benchmark as rb

    rb.CSV_DIR = csv_dir


def _write_one(sr: dict) -> None:
    import hyde_bench.run_benchmark as rb

    from .db.payloads import read_payload
    from .exports import _reconstruct_results

    payload = read_payload(Path(sr["payloads_path"]))
    results = _reconstruct_results(payload)
    rb.save_per_run_csv(sr["algo_key"], sr["fname"], sr["dim"], results)


def main() -> int:
    parser = argparse.ArgumentParser(prog="suite.csv_worker")
    parser.add_argument(
        "--args",
        required=True,
        help="path to the JSON spec written by the export pipeline",
    )
    ns = parser.parse_args()
    spec = json.loads(Path(ns.args).read_text(encoding="utf-8"))

    os.environ["MPLBACKEND"] = "Agg"

    import hyde_bench.run_benchmark as rb

    from .exports import reference_output_context

    detail = {
        "n_runs": spec["n_runs"],
        "max_evals": spec["max_evals"],
        "alpha": spec["alpha"],
        "test_cases": spec["test_cases"],
    }
    srs = spec["scenario_results"]
    failures: list[str] = []
    with reference_output_context(Path(spec["run_dir"]), detail):
        csv_dir = str(rb.CSV_DIR)
        workers = min(CSV_POOL_SIZE, os.cpu_count() or 1, len(srs)) or 1
        if workers <= 1:
            for sr in srs:
                try:
                    _write_one(sr)
                except Exception as exc:  # noqa: BLE001 - reported to parent
                    failures.append(
                        f"save_per_run_csv[{sr['fname']}_{sr['dim']}D/"
                        f"{sr['algo_key']}]: {exc}"
                    )
        else:
            with ProcessPoolExecutor(
                max_workers=workers,
                initializer=_init_worker,
                initargs=(csv_dir,),
            ) as ex:
                futures = {ex.submit(_write_one, sr): sr for sr in srs}
                for fut, sr in futures.items():
                    exc = fut.exception()
                    if exc is not None:
                        failures.append(
                            f"save_per_run_csv[{sr['fname']}_{sr['dim']}D/"
                            f"{sr['algo_key']}]: {exc}"
                        )

    print(json.dumps({"failures": failures}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
