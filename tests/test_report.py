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
