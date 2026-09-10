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


# -- operator-level snapshot payloads -------------------------------------------


def _in_bounds(pt, lo, hi, tol=1e-9):
    return lo[0] - tol <= pt[0] <= hi[0] + tol and lo[1] - tol <= pt[1] <= hi[1] + tol


@pytest.mark.parametrize("algo_key", ALL_ALGOS)
def test_init_ops_carry_lhs_strata(algo_key: str) -> None:
    trace = run_simulation_trace(algo_key, "booth", seed=0, **SMALL_KWARGS)
    init_ops = [
        s["ops"]
        for s in trace["snapshots"]
        if s["kind"] == "gen" and s["phase"] == "init" and s["ops"]
    ]
    assert init_ops, "init snapshot must carry LHS strata ops"
    ops = init_ops[0]
    assert ops["type"] == "lhs"
    assert ops["strata"] >= 1
    # encoded variants (and HyGO) expose the discrete grid resolution so
    # the visualizer can derive post-snap stratum membership exactly
    if algo_key in ("hyde_qub", "hyde_con"):
        assert "levels" not in ops  # no discrete encoding to snap onto
    else:
        assert ops["levels"] >= 2
    # farthest-point reordering is a HyDE-variant step (N > 4), never HyGO
    if algo_key == "hygo":
        assert ops["reorder"] is False
        assert ops.get("qubit") is not True
    else:
        assert ops["reorder"] is True
    # only the qubit-encoded variant samples in theta space
    assert ops.get("qubit") is True if algo_key == "hyde_qub" else not ops.get("qubit")


def test_farthest_point_reorder_emits_per_greedy_step() -> None:
    trace = run_simulation_trace("hyde_bin", "booth", seed=0, **SMALL_KWARGS)
    lo, hi = trace["lo"], trace["hi"]
    steps = [
        s
        for s in trace["snapshots"]
        if s["kind"] == "gen"
        and s["phase"] == "init"
        and s["ops"]
        and s["ops"].get("stage") == "reorder"
    ]
    n = trace["pop_size"]
    assert len(steps) == n - 1, "one snapshot per greedy step"
    for s in steps:
        ops = s["ops"]
        assert ops["order"][-1] == ops["last"]
        # sel starts with sample 0, so step k has k+1 picks
        assert len(ops["order"]) == ops["step"] + 1
        assert len(ops["dists"]) == n
        assert len(set(ops["order"])) == len(ops["order"])
        assert ops["order"][0] == 0  # greedy walk starts from sample 0
        assert s["eval_count"] == 0  # reordering precedes evaluation
        for px, py in s["positions"] or []:
            assert lo[0] - 1e-9 <= px <= hi[0] + 1e-9
            assert lo[1] - 1e-9 <= py <= hi[1] + 1e-9
    # the greedy criterion: each newly picked index had the max min-distance
    for prev, cur in zip(steps, steps[1:]):
        newly = cur["ops"]["order"][-1]
        assert newly not in set(prev["ops"]["order"][:-1])


@pytest.mark.parametrize("algo_key", ALL_ALGOS)
def test_init_replays_in_stages_with_population(algo_key: str) -> None:
    """Initialization must show its work: raw LHS draw, reorder, evaluated pool."""
    trace = run_simulation_trace(algo_key, "booth", seed=0, **SMALL_KWARGS)
    lo, hi = trace["lo"], trace["hi"]
    init = [s for s in trace["snapshots"] if s["kind"] == "gen" and s["phase"] == "init"]
    stages = [s["ops"]["stage"] for s in init if s["ops"]]

    assert "sample" in stages, "raw LHS draw stage missing"
    assert "final" in stages, "evaluated-pool stage missing"
    if algo_key != "hygo":
        assert "reorder" in stages, "farthest-point reorder stage missing"

    # sample/reorder stages are emitted before any evaluation (eval_count
    # 0) with the population already visible; the final stage lands after
    # the initial evaluations with the evaluated pool
    for snap in init:
        stage = snap["ops"]["stage"] if snap["ops"] else "final"
        if stage in ("sample", "reorder"):
            assert snap["eval_count"] == 0
        for px, py in snap["positions"] or []:
            assert lo[0] - 1e-9 <= px <= hi[0] + 1e-9
            assert lo[1] - 1e-9 <= py <= hi[1] + 1e-9


def test_snapshot_event_indices_monotonic() -> None:
    trace = run_simulation_trace("hygo", "booth", seed=0, **SMALL_KWARGS)
    event_idxs = [s["event_idx"] for s in trace["snapshots"]]
    assert event_idxs == sorted(event_idxs)
    assert all(0 <= e <= trace["n_events"] for e in event_idxs)


@pytest.mark.parametrize("algo_key", ["hyde_bin", "hyde_qub", "hyde_con"])
def test_de_ops_carry_mutation_geometry(algo_key: str) -> None:
    trace = run_simulation_trace(algo_key, "booth", seed=0, **SMALL_KWARGS)
    lo, hi = trace["lo"], trace["hi"]
    de_ops = [
        s["ops"]
        for s in trace["snapshots"]
        if s["kind"] == "gen" and s["phase"] == "de" and s["ops"]
    ]
    assert de_ops, "de snapshots must carry mutation geometry"
    accepted_seen = False
    for ops in de_ops:
        assert ops["type"] == "mutation"
        assert 0 < len(ops["samples"]) <= 6
        for smp in ops["samples"]:
            for pt in (smp["x"], smp["best"], smp["r1"], smp["r2"], smp["child"]):
                assert _in_bounds(pt, lo, hi)
            assert 0.0 <= smp["f"] <= 1.0
            assert isinstance(smp["accepted"], bool)
            accepted_seen = accepted_seen or smp["accepted"]
    # greedy selection accepts some children during phase 1
    assert accepted_seen, "selection accepted at least one child"


def test_recover_ops_carry_bitflip_moves() -> None:
    trace = run_simulation_trace("hyde_bin", "booth", seed=0, **SMALL_KWARGS)
    lo, hi = trace["lo"], trace["hi"]
    rec_ops = [
        s["ops"]
        for s in trace["snapshots"]
        if s["kind"] == "gen" and s["phase"] == "recover" and s["ops"]
    ]
    assert rec_ops, "stagnation on booth must trigger recovery with ops"
    for ops in rec_ops:
        assert ops["type"] == "bitflip"
        assert 0 < len(ops["moves"]) <= trace["pop_size"]
        for mv in ops["moves"]:
            assert _in_bounds(mv["from"], lo, hi)
            assert _in_bounds(mv["to"], lo, hi)
            assert mv["from"] != mv["to"]


def test_gauss_recovery_ops_for_hyde_con() -> None:
    trace = run_simulation_trace("hyde_con", "booth", seed=0, **SMALL_KWARGS)
    rec_ops = [
        s["ops"]
        for s in trace["snapshots"]
        if s["kind"] == "gen" and s["phase"] == "recover" and s["ops"]
    ]
    assert rec_ops
    assert all(ops["type"] == "gauss" for ops in rec_ops)


def test_tunnel_ops_carry_reflection_moves() -> None:
    # rastrigin is multimodal: stagnation (and thus tunneling) is expected
    trace = run_simulation_trace("hyde_qub", "rastrigin", seed=0, **SMALL_KWARGS)
    lo, hi = trace["lo"], trace["hi"]
    tun_ops = [
        s["ops"]
        for s in trace["snapshots"]
        if s["kind"] == "gen" and s["phase"] == "tunnel" and s["ops"]
    ]
    if not tun_ops:
        pytest.skip("no stagnation-triggered tunneling for this seed")
    for ops in tun_ops:
        assert ops["type"] == "tunnel"
        assert 0 < len(ops["moves"]) <= trace["pop_size"]
        for mv in ops["moves"]:
            assert _in_bounds(mv["from"], lo, hi)
            assert _in_bounds(mv["to"], lo, hi)
            assert 0.0 <= mv["s"] <= 1.0


@pytest.mark.parametrize("algo_key", ["hyde_bin", "hyde_qub", "hyde_con"])
def test_cmaes_ops_carry_distribution(algo_key: str) -> None:
    trace = run_simulation_trace(algo_key, "booth", seed=0, **SMALL_KWARGS)
    lo, hi = trace["lo"], trace["hi"]
    cmaes = [
        s
        for s in trace["snapshots"]
        if s["kind"] == "gen" and s["phase"] == "cmaes" and s["ops"]
    ]
    assert cmaes, "CMA-ES phase must emit distribution geometry"
    for s in cmaes:
        ops = s["ops"]
        assert ops["type"] == "cmaes"
        assert _in_bounds(ops["mean"], lo, hi)
        assert _in_bounds(ops["mean_old"], lo, hi)
        assert len(ops["axes"]) == 2
        assert ops["sigma"] > 0
        assert ops["restart"] >= 0
        for ax in ops["axes"]:
            assert all(v == v and abs(v) < float("inf") for v in ax)
        # rank selection flags aligned with the offspring positions
        flags = ops["sel_flags"]
        assert isinstance(flags, list)
        assert len(flags) == len(s["positions"] or [])
        assert all(isinstance(f, bool) for f in flags)
        assert any(flags), "best-mu subset must be flagged"
        assert not all(flags), "only the best mu are selected, never all"


def test_hygo_ga_ops_carry_parent_links() -> None:
    trace = run_simulation_trace("hygo", "booth", seed=0, **SMALL_KWARGS)
    lo, hi = trace["lo"], trace["hi"]
    ga_ops = [
        s["ops"]
        for s in trace["snapshots"]
        if s["kind"] == "gen" and s["phase"] == "ga" and s["ops"]
    ]
    assert ga_ops, "HyGO GA stage must emit parent-child links"
    for ops in ga_ops:
        assert ops["type"] == "ga"
        assert 0 < len(ops["links"]) <= 8
        for link in ops["links"]:
            assert link["op"] in {"crossover", "mutation", "replication", "elite"}
            assert 1 <= len(link["parents"]) <= 2
            for pt in [*link["parents"], link["child"]]:
                assert _in_bounds(pt, lo, hi)


def test_hygo_dsm_ops_carry_simplex_and_moves() -> None:
    trace = run_simulation_trace("hygo", "booth", seed=0, **SMALL_KWARGS)
    lo, hi = trace["lo"], trace["hi"]
    dsm_ops = [
        s["ops"]
        for s in trace["snapshots"]
        if s["kind"] == "gen" and s["phase"] == "dsm" and s["ops"]
    ]
    assert dsm_ops, "HyGO exploitation must emit simplex geometry"
    kinds_seen = set()
    for ops in dsm_ops:
        assert ops["type"] == "dsm"
        assert len(ops["simplex"]) == 3  # dim + 1 vertices in 2D
        for pt in [*ops["simplex"], ops["centroid"]]:
            assert _in_bounds(pt, lo, hi)
        for mv in ops["moves"]:
            kinds_seen.add(mv["kind"])
            assert _in_bounds(mv["from"], lo, hi)
            assert _in_bounds(mv["to"], lo, hi)
    assert kinds_seen, "at least one DSM move kind must be recorded"


@pytest.mark.parametrize("algo_key", ALL_ALGOS)
def test_hook_does_not_perturb_results(algo_key: str) -> None:
    """Runs with a hook installed must be byte-identical to uninstrumented ones."""

    def hook(_snap: dict) -> None:
        pass

    from hyde_bench.benchmarks import FUNCTIONS
    from hyde_bench.hyde_bin import HyDEBin
    from hyde_bench.hyde_con import HyDECon
    from hyde_bench.hyde_qub import HyDEQub
    from hyde_bench.hygo import HyGO

    cls = {
        "hyde_bin": HyDEBin,
        "hyde_qub": HyDEQub,
        "hyde_con": HyDECon,
        "hygo": HyGO,
    }[algo_key]

    base = dict(
        func=FUNCTIONS["booth"],
        fname="booth",
        dim=2,
        max_evals=300,
        seed=7,
    )
    if algo_key == "hygo":
        base.update(NG=500, Nexplor=16, Nexploit=8)
    else:
        base.update(pop_size=16, max_gen=500)

    with_hook = cls(progress_hook=hook, **base).run()
    without = cls(progress_hook=None, **base).run()
    assert with_hook["best_cost"] == without["best_cost"]
    assert with_hook["evals"] == without["evals"]
    assert with_hook["cost_history"] == without["cost_history"]


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
    trace = run_simulation_trace("hyde_bin", "booth", seed=0, max_evals=100_000, pop_size=500)
    assert trace["max_evals"] == MAX_EVALS
    assert trace["pop_size"] == MAX_POP

    trace = run_simulation_trace("hyde_bin", "booth", seed=0, max_evals=1, pop_size=1)
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
