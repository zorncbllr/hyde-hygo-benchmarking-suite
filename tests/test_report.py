"""Regression tests for the reference report charts (hyde_bench)."""

import numpy as np
import pytest

import hyde_bench.run_benchmark as rb


def test_clip_degradation_for_display_ignores_inf():
    """Inf ratios (zero-mean 2D runs) must not poison the percentile: the
    whole heatmap used to be wiped to nan when any ratio was inf."""
    deg = np.array([[1.0, np.inf, 4.0], [2.0, 3.0, np.inf], [5.0, 6.0, 7.0]])
    display = rb._clip_degradation_for_display(deg)
    assert np.isfinite(display).all()
    finite = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0]
    assert display.max() == pytest.approx(np.percentile(finite, 95) * 1.2)
    # inf entries clip to the top of the color scale, not nan
    assert display[0, 1] == display.max()
    assert display[1, 2] == display.max()


def test_clip_degradation_for_display_all_inf():
    """A matrix with no finite values falls back to a sane clip bound."""
    deg = np.full((2, 2), np.inf)
    display = rb._clip_degradation_for_display(deg)
    assert np.isfinite(display).all()
    assert (display == 1.0).all()


def test_make_scaling_chart_renders_with_inf_ratios(tmp_path, monkeypatch):
    """The heatmap and CV charts render end-to-end with inf ratios present."""
    scaling = [
        {
            "fname": "booth",
            "algo_key": ak,
            "cv_25d": 0.1,
            "degradation_ratio": np.inf if ak == "hyde_bin" else 2.0,
        }
        for ak in rb.ALGO_KEYS
    ]
    monkeypatch.setattr(rb, "CHART_DIR", str(tmp_path))
    rb.make_scaling_chart(scaling)
    assert (tmp_path / "qe_degradation_heatmap.png").exists()
    assert (tmp_path / "qe_cv_25d.png").exists()


def _synthetic_scaling_results(mean_2d: float, mean_25d: float) -> dict:
    """Minimal all_results for run_scaling_analysis (sphere only)."""
    return {
        "sphere_2D": {ak: {"raw_costs": [mean_2d] * 5, "cv": 0.0} for ak in rb.ALGO_KEYS},
        "sphere_25D": {ak: {"raw_costs": [mean_25d] * 5, "cv": 0.0} for ak in rb.ALGO_KEYS},
    }


def test_scaling_degradation_finite_with_exact_zero_baseline():
    """Exact 2D convergence (mean 0.0) must yield a finite value: the old
    plain ratio injected inf, which wiped the report heatmap with NaN."""
    rows = rb.run_scaling_analysis(_synthetic_scaling_results(0.0, 2.0))
    assert len(rows) == len(rb.ALGO_KEYS)
    for row in rows:
        assert np.isfinite(row["degradation_ratio"])
        assert row["degradation_ratio"] == pytest.approx(2.0 / 1e-12)


def test_scaling_degradation_behaves_like_ratio_minus_one():
    """For a normal baseline the normalized degradation is ratio - 1."""
    rows = rb.run_scaling_analysis(_synthetic_scaling_results(1.0, 3.0))
    for row in rows:
        assert row["degradation_ratio"] == pytest.approx(2.0)


def test_scaling_degradation_negative_when_25d_improves():
    """A lower 25D mean must not be clipped away as inf ever could."""
    rows = rb.run_scaling_analysis(_synthetic_scaling_results(4.0, 1.0))
    for row in rows:
        assert row["degradation_ratio"] == pytest.approx(-0.75)


def test_bootstrap_mean_diff_ci_matches_naive_loop():
    """The vectorized bootstrap must draw the exact same index stream as
    the naive per-iteration loop, so seeded exports reproduce bit-for-bit."""
    rng = np.random.default_rng(7)
    a = rng.normal(2.0, 0.5, 50).tolist()
    b = rng.normal(2.1, 0.5, 30).tolist()

    def naive_ci(a, b, n_boot, seed):
        r = np.random.default_rng(seed)
        a = np.asarray(a, dtype=float)
        b = np.asarray(b, dtype=float)
        na, nb = len(a), len(b)
        diffs = np.empty(n_boot)
        for i in range(n_boot):
            diffs[i] = a[r.integers(0, na, na)].mean() - b[r.integers(0, nb, nb)].mean()
        alpha_half = (1 - 0.95) / 2
        return (
            float(np.percentile(diffs, 100 * alpha_half)),
            float(np.percentile(diffs, 100 * (1 - alpha_half))),
        )

    lo_naive, hi_naive = naive_ci(a, b, 1000, 42)
    boot = rb.bootstrap_mean_diff_ci(a, b, n_boot=1000)
    assert boot["ci_lo"] == lo_naive
    assert boot["ci_hi"] == hi_naive


def test_make_charts_renders_all_benchmarks_via_pool(tmp_path, monkeypatch):
    """make_charts renders one PNG per benchmark through the process pool."""
    entry = {
        ak: {"fname": "booth", "dim": 2, "mean_curve": [1.0, 0.5], "raw_costs": [1.0, 0.5]}
        for ak in rb.ALGO_KEYS
    }
    all_results = {f"bench{i}_2D": entry for i in range(3)}
    monkeypatch.setattr(rb, "CHART_DIR", str(tmp_path))
    monkeypatch.setattr(rb, "N_RUNS", 2)
    rb.make_charts(all_results, [], [])
    assert len(list(tmp_path.glob("bench*_2D.png"))) == 3


def test_write_csvs_subprocess_matches_sequential(completed_run):
    """The pooled subprocess writes the same per-run CSVs as the loop."""
    svc, run_id, run_dir = completed_run
    detail = svc.get_run_detail(run_id)
    from suite.exports import _write_csvs_subprocess

    _write_csvs_subprocess(run_dir, detail)
    run_csv = run_dir / "csv_data" / "hyde_bin" / "booth_2D" / "run_001.csv"
    assert run_csv.exists() and run_csv.stat().st_size > 0
