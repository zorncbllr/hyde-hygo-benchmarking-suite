"""Tests for the interactive simulation service (line tracing + beats)."""

from __future__ import annotations

import pytest

from suite.simulation import (
    ALGO_BEATS,
    ALGO_MODULES,
    MAX_EVALS,
    MAX_POP,
    MAX_TRACE_EVENTS,
    MIN_EVALS,
    MIN_POP,
    SimulationError,
    resolve_beats,
    run_simulation_trace,
    unpack_events,
)

ALL_ALGOS = tuple(ALGO_MODULES)
SMALL_KWARGS = {"max_evals": 300, "pop_size": 16}


# -- trace structure ------------------------------------------------------------


@pytest.mark.parametrize("algo_key", ALL_ALGOS)
def test_trace_structure(algo_key: str) -> None:
    trace = run_simulation_trace(algo_key, "booth", seed=0, **SMALL_KWARGS)

    assert trace["algo_key"] == algo_key
    assert trace["fname"] == "booth"
    assert trace["dim"] == 2
    n_events = trace["n_events"]
    assert n_events > 0
    func, line, evals, beats_idx = unpack_events(trace["events_payload"])
    assert len(func) == len(line) == len(evals) == len(beats_idx) == n_events
    assert trace["func_names"], "tracer must record at least one function"
    assert trace["source"].startswith(("import", '"""'))
    assert not trace["truncated"]

    # source contains the traced module's class
    class_name = ALGO_MODULES[algo_key][1]
    assert f"class {class_name}" in trace["source"]

    # final event eval count matches the result
    assert evals[-1] == trace["result"]["evals"]

    # result sanity
    res = trace["result"]
    assert res["evals"] > 0
    assert res["best_cost"] < float("inf")
    if res["best_x"] is not None:
        assert len(res["best_x"]) == 2


@pytest.mark.parametrize("algo_key", ALL_ALGOS)
def test_eval_counts_monotonic(algo_key: str) -> None:
    trace = run_simulation_trace(algo_key, "booth", seed=0, **SMALL_KWARGS)
    _, _, evals, _ = unpack_events(trace["events_payload"])
    assert all(b >= a for a, b in zip(evals, evals[1:]))
    assert evals[-1] == trace["result"]["evals"]


@pytest.mark.parametrize("algo_key", ALL_ALGOS)
def test_event_lines_within_source(algo_key: str) -> None:
    trace = run_simulation_trace(algo_key, "booth", seed=0, **SMALL_KWARGS)
    n_lines = len(trace["source"].splitlines())
    func_idx, linenos, _, _ = unpack_events(trace["events_payload"])
    for fi, ln in zip(func_idx, linenos):
        assert 0 <= fi < len(trace["func_names"])
        assert 1 <= ln <= n_lines


@pytest.mark.parametrize("algo_key", ALL_ALGOS)
def test_event_beats_map_to_valid_ranges(algo_key: str) -> None:
    trace = run_simulation_trace(algo_key, "booth", seed=0, **SMALL_KWARGS)
    beats = trace["beats"]
    _, linenos, _, beats_idx = unpack_events(trace["events_payload"])
    for beat_idx, ln in zip(beats_idx, linenos):
        if beat_idx == -1:
            continue
        beat = beats[beat_idx]
        assert beat["start_line"] <= ln <= beat["end_line"]


def test_trace_is_deterministic() -> None:
    a = run_simulation_trace("hyde_bin", "booth", seed=42, **SMALL_KWARGS)
    b = run_simulation_trace("hyde_bin", "booth", seed=42, **SMALL_KWARGS)
    assert a["events_payload"] == b["events_payload"]
    assert a["n_events"] == b["n_events"]
    assert a["result"] == b["result"]


def test_different_seeds_diverge() -> None:
    a = run_simulation_trace("hyde_bin", "booth", seed=0, **SMALL_KWARGS)
    b = run_simulation_trace("hyde_bin", "booth", seed=1, **SMALL_KWARGS)
    assert a["events_payload"] != b["events_payload"]


# -- snapshots ------------------------------------------------------------------


@pytest.mark.parametrize("algo_key", ALL_ALGOS)
def test_snapshots_ordered_and_populated(algo_key: str) -> None:
    trace = run_simulation_trace(algo_key, "booth", seed=0, **SMALL_KWARGS)
    snaps = trace["snapshots"]
    assert len(snaps) >= trace["result"]["evals"] // 4

    eval_snaps = [s for s in snaps if s["kind"] == "eval"]
    gen_snaps = [s for s in snaps if s["kind"] == "gen"]

    assert eval_snaps, "eval snapshots are captured per evaluation"
    eval_counts = [s["eval_count"] for s in eval_snaps]
    assert eval_counts == sorted(eval_counts)

    # eval snapshots carry best-cost state
    assert all(s["best_cost"] < float("inf") for s in eval_snaps)
    # best cost is monotone non-increasing across eval snapshots
    costs = [s["best_cost"] for s in eval_snaps]
    assert all(b <= a for a, b in zip(costs, costs[1:]))

    # gen snapshots from the progress hook carry 2D positions
    assert gen_snaps
    for snap in gen_snaps:
        if snap["positions"] is not None:
            for px, py in snap["positions"]:
                lo, hi = trace["lo"], trace["hi"]
                assert lo[0] - 1e-9 <= px <= hi[0] + 1e-9
                assert lo[1] - 1e-9 <= py <= hi[1] + 1e-9


def test_gen_snapshots_exist_for_all_phases() -> None:
    trace = run_simulation_trace("hyde_bin", "booth", seed=0, **SMALL_KWARGS)
    phases = {s["phase"] for s in trace["snapshots"] if s["kind"] == "gen"}
    assert {"init", "de"} <= phases


# -- curated beats --------------------------------------------------------------


@pytest.mark.parametrize("algo_key", ALL_ALGOS)
def test_all_beat_anchors_resolve(algo_key: str) -> None:
    trace = run_simulation_trace(algo_key, "booth", seed=0, **SMALL_KWARGS)
    assert len(trace["beats"]) == len(ALGO_BEATS[algo_key])


@pytest.mark.parametrize("algo_key", ALL_ALGOS)
def test_beat_ranges_tile_the_source(algo_key: str) -> None:
    trace = run_simulation_trace(algo_key, "booth", seed=0, **SMALL_KWARGS)
    beats = trace["beats"]
    n_lines = len(trace["source"].splitlines())
    starts = [b["start_line"] for b in beats]
    assert starts == sorted(starts)
    assert len(set(starts)) == len(starts)
    for i, beat in enumerate(beats):
        assert 1 <= beat["start_line"] <= beat["end_line"] <= n_lines
        assert beat["phase"] and beat["title"] and beat["body"]
        if i + 1 < len(beats):
            assert beat["end_line"] == beats[i + 1]["start_line"] - 1


def test_resolve_beats_drops_unknown_anchor() -> None:
    from suite.simulation import ALGO_BEATS

    beats = resolve_beats("class Foo:\n    pass\n", "hygo")
    # hygo's anchors cannot match an unrelated source; all are dropped
    assert beats == []
    assert "hygo" in ALGO_BEATS


def test_beat_index_for_line() -> None:
    from suite.simulation import _beat_index_for_line

    beats = [
        {"start_line": 1, "end_line": 5},
        {"start_line": 6, "end_line": 10},
    ]
    assert _beat_index_for_line(beats, 1) == 0
    assert _beat_index_for_line(beats, 5) == 0
    assert _beat_index_for_line(beats, 6) == 1
    assert _beat_index_for_line(beats, 10) == 1
    assert _beat_index_for_line(beats, 11) == 1  # clamps to the last beat
    assert _beat_index_for_line([], 3) == -1


# -- validation -----------------------------------------------------------------


def test_unknown_algo_rejected() -> None:
    with pytest.raises(SimulationError, match="unknown algorithm"):
        run_simulation_trace("nope", "booth")


def test_unknown_fname_rejected() -> None:
    with pytest.raises(SimulationError, match="unknown benchmark function"):
        run_simulation_trace("hyde_bin", "not_a_function")


def test_negative_seed_rejected() -> None:
    with pytest.raises(SimulationError, match="seed"):
        run_simulation_trace("hyde_bin", "booth", seed=-1)


def test_budget_and_population_clamped() -> None:
    trace = run_simulation_trace(
        "hyde_bin", "booth", seed=0, max_evals=100_000, pop_size=500
    )
    assert trace["max_evals"] == MAX_EVALS
    assert trace["pop_size"] == MAX_POP

    trace = run_simulation_trace(
        "hyde_bin", "booth", seed=0, max_evals=1, pop_size=1
    )
    assert trace["max_evals"] == MIN_EVALS
    assert trace["pop_size"] == MIN_POP


def test_event_cap_sets_truncated_flag() -> None:
    # HyGO on a multimodal function at max budget generates the most events;
    # force the cap low via monkeypatch to verify the flag without a long run.
    import suite.simulation as sim

    original = sim.MAX_TRACE_EVENTS
    sim.MAX_TRACE_EVENTS = 1
    try:
        trace = run_simulation_trace("hygo", "booth", seed=0, **SMALL_KWARGS)
        assert trace["truncated"] is True
    finally:
        sim.MAX_TRACE_EVENTS = original
    assert MAX_TRACE_EVENTS > 0
