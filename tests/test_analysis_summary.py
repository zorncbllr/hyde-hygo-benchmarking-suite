"""Tests for the analysis snapshot shared by exports and the on-demand
``get_analysis`` IPC command, and for the batched scenario payload reader.

The desktop UI renders its Statistical analyses tab directly from
``analysis_summary.json`` (or the identical on-demand computation), so these
tests guard the contract that the UI mirrors the exported DOCX report.
"""

import json
from pathlib import Path

import pytest

from suite.db.payloads import resolve_scenario_payloads
from suite.exports import (
    _jsonify,
    compute_analysis_summary,
    load_results,
    run_exports_sync,
)

EXPECTED_KEYS = {
    "friedman_objective_error",
    "kruskal_per_scenario",
    "cochrans_q",
    "chi2_convergence",
    "friedman_wall_time",
    "wall_time_kruskal",
    "margin_vs_hygo",
    "scaling",
}


def test_compute_analysis_summary_section_keys(completed_run):
    """The analysis snapshot contains every section of the DOCX report."""
    svc, run_id, run_dir = completed_run
    summary = compute_analysis_summary(load_results(run_dir))
    assert EXPECTED_KEYS <= set(summary.keys())


def test_exported_analysis_matches_on_demand_computation(completed_run):
    """analysis_summary.json written by exports is identical to computing
    the analyses on demand — the UI must never show different numbers than
    the exported report."""
    svc, run_id, run_dir = completed_run
    run_exports_sync(run_id, svc, ["json"])
    exported = json.loads(
        (run_dir / "analysis_summary.json").read_text(encoding="utf-8")
    )
    on_demand = compute_analysis_summary(load_results(run_dir))
    assert exported == on_demand


def test_jsonify_sanitizes_non_finite_floats():
    """Non-finite floats become null so serde_json can transport them."""
    data = {"a": float("inf"), "b": [1.0, float("nan")], "c": {"d": float("-inf")}}
    clean = _jsonify(data)
    assert clean == {"a": None, "b": [1.0, None], "c": {"d": None}}


def test_resolve_scenario_payloads_batches_all_algorithms(completed_run):
    svc, run_id, run_dir = completed_run
    detail = svc.get_run_detail(run_id)
    payloads = resolve_scenario_payloads(run_dir, detail["scenario_results"], "booth_2D")
    assert set(payloads.keys()) == {"hyde_bin", "hyde_qub", "hyde_con", "hygo"}
    for payload in payloads.values():
        assert isinstance(payload["raw_costs"], list)
        assert len(payload["raw_costs"]) == 2  # n_runs


def test_resolve_scenario_payloads_unknown_scenario(completed_run):
    svc, run_id, run_dir = completed_run
    detail = svc.get_run_detail(run_id)
    with pytest.raises(ValueError, match="unknown scenario"):
        resolve_scenario_payloads(run_dir, detail["scenario_results"], "sphere_25D")


def test_resolve_scenario_payloads_rejects_path_traversal(completed_run):
    svc, run_id, run_dir = completed_run
    detail = svc.get_run_detail(run_id)
    escaped = [dict(sr, payloads_path="../../evil.zst") for sr in detail["scenario_results"]]
    with pytest.raises(ValueError, match="invalid payload path"):
        resolve_scenario_payloads(run_dir, escaped, "booth_2D")


def test_resolve_scenario_payloads_missing_file(completed_run):
    svc, run_id, run_dir = completed_run
    detail = svc.get_run_detail(run_id)
    missing = [dict(sr, payloads_path="nope.zst") for sr in detail["scenario_results"]]
    with pytest.raises(FileNotFoundError):
        resolve_scenario_payloads(run_dir, missing, "booth_2D")
