"""Clean-subprocess chart renderer.

The export pipeline normally renders charts in-process. When the embedded
app process has corrupted matplotlib renderer geometry (inflated figure
sizes / text extents; symptoms: "Image size of NNNxNNN pixels is too
large", "FT_Render_Glyph ... raster overflow", "std::bad_alloc"), no amount
of in-process state repair is trustworthy. This worker re-runs a single
``hyde_bench.run_benchmark`` chart function in a fresh interpreter with a
clean matplotlib state so the export can still produce every chart.

Input is a JSON spec file written by ``suite.exports`` with the chart
function name, its arguments, and the run configuration mirror that
``reference_output_context`` normally applies. See ``--args`` below.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(prog="suite.chart_worker")
    parser.add_argument(
        "--args",
        required=True,
        help="path to the JSON spec written by the export pipeline",
    )
    ns = parser.parse_args()
    spec = json.loads(Path(ns.args).read_text(encoding="utf-8"))

    os.environ["MPLBACKEND"] = "Agg"
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    # stale figures from a half-finished import chain must not leak in
    plt.close("all")
    if plt.rcParams["figure.dpi"] != 100:
        plt.rcParams["figure.dpi"] = 100

    import hyde_bench.run_benchmark as rb

    from .exports import reference_output_context

    detail = {
        "n_runs": spec["n_runs"],
        "max_evals": spec["max_evals"],
        "alpha": spec["alpha"],
        "test_cases": spec["test_cases"],
    }
    fn = getattr(rb, spec["fn"])
    with reference_output_context(Path(spec["run_dir"]), detail):
        fn(*spec["args"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
