"""Interactive algorithm simulation: line-level execution tracing.

Runs one of the four vendored algorithms on a small 2D scenario while a
``sys.settrace`` tracer records every executed line of the algorithm's own
module (frames from numpy or the benchmark library are skipped). The result
is a compact, replayable trace the UI can play back: each step highlights
the exact line that executed, synchronized with state snapshots (population
positions, best cost, eval count).

On top of the raw trace, a curated set of "beats" -- pedagogical
explanations -- is resolved by substring anchors against the live source at
trace time. Anchors are never line numbers, so the mapping survives source
changes; anchors that no longer match degrade gracefully instead of
mislabeling code.

All inputs are validated and capped: the simulation is meant for
comprehension, not benchmarking-grade budgets.
"""

from __future__ import annotations

import base64
import importlib
import inspect
import sys
import zlib
from array import array
from typing import Any

from hyde_bench.benchmarks import FUNCTIONS, get_bounds

ALGO_MODULES: dict[str, tuple[str, str]] = {
    "hyde_bin": ("hyde_bench.hyde_bin", "HyDEBin"),
    "hyde_qub": ("hyde_bench.hyde_qub", "HyDEQub"),
    "hyde_con": ("hyde_bench.hyde_con", "HyDECon"),
    "hygo": ("hyde_bench.hygo", "HyGO"),
}

# Hard caps: the trace must stay replayable and the payload bounded.
MIN_EVALS = 200
MAX_EVALS = 1000
DEFAULT_EVALS = 400
MIN_POP = 8
MAX_POP = 30
DEFAULT_POP = 24
MAX_DIM = 2
MAX_TRACE_EVENTS = 120_000


class SimulationError(ValueError):
    """Raised for invalid simulation requests (unknown algo/function...)."""


# -- Curated beats ------------------------------------------------------------
#
# Each beat anchors on the FIRST source line containing ``anchor`` (a plain
# substring, chosen to be unique within its module) and extends to the next
# resolved anchor. ``phase`` groups beats into the timeline navigation.

_BEATS_HYDE_COMMON = [
    {
        "phase": "overview",
        "title": "Hybrid architecture: DE phase 1 + CMA-ES phase 2",
        "body": (
            "The evaluation budget is split 60/40: phase 1 runs a "
            "current-to-best differential-evolution loop that is cheap and "
            "globally orienting; phase 2 hands the remaining budget to "
            "IPOP-CMA-ES for precise local refinement, warm-started from the "
            "points the DE phase already found."
        ),
        "anchor": "class HyDE",
    },
]

_BEATS_HYDE_BIN = [
    *_BEATS_HYDE_COMMON,
    {
        "phase": "encode",
        "title": "Binary encoding: 12 bits per parameter",
        "body": (
            "Each real parameter is quantized to one of 2^12 = 4096 discrete "
            "values on its bounds interval. The DE operators work on decoded "
            "real vectors for good geometry, while the binary chromosome is "
            "kept in sync; decoding snaps candidates back onto the grid."
        ),
        "anchor": "idx = np.round((x - self.lo)",
    },
    {
        "phase": "eval",
        "title": "Evaluation: bookkeeping + sorted archive",
        "body": (
            "Every candidate evaluation updates the best-so-far cost and "
            "position, appends to the convergence history, and inserts the "
            "point into a cost-sorted archive. That archive later seeds the "
            "CMA-ES covariance and restart means."
        ),
        "anchor": "cost = float(self.func(x))",
    },
    {
        "phase": "init",
        "title": "Latin Hypercube init + farthest-point reordering",
        "body": (
            "Initialization uses Latin Hypercube Sampling: each dimension is "
            "split into N strata with exactly one jittered sample per stratum, "
            "giving even marginal coverage. Farthest-point reordering then "
            "visits samples so consecutive individuals are maximally distant, "
            "removing ordering bias in the initial population."
        ),
        "anchor": "perm = self.rng.permutation(N)",
    },
    {
        "phase": "de",
        "title": "Generation setup: best individual + DE parameters",
        "body": (
            "Each generation needs the current best vector as an attraction "
            "center and two random distinct partners per individual. The "
            "mutation factor F is drawn per individual from U(0.5, 0.8); the "
            "crossover rate cr is high (0.9) for high-dimensional problems."
        ),
        "anchor": "best_x = pop_x[int(np.argmin(fitness))]",
    },
    {
        "phase": "de",
        "title": "DE/current-to-best/1 mutation",
        "body": (
            "mutant = x_i + F*(best - x_i) + F*(x_r1 - x_r2): every "
            "individual is pulled toward the population best while being "
            "pushed by a random difference vector. This balances exploitation "
            "(best-direction) with exploration (random pair difference)."
        ),
        "anchor": "mutants = pop_x + F[:, None]",
    },
    {
        "phase": "de",
        "title": "Binomial crossover",
        "body": (
            "Each gene of the child is inherited from the mutant with "
            "probability cr, otherwise from the parent. One random gene index "
            "is forced to come from the mutant, guaranteeing the child "
            "actually differs from its parent."
        ),
        "anchor": "mask = self.rng.random((N, dim)) < cr",
    },
    {
        "phase": "de",
        "title": "Greedy one-to-one selection",
        "body": (
            "A child replaces its parent only if it is not worse. Selection "
            "pressure is therefore weak but elitist: population fitness never "
            "deteriorates, and diversity decays slowly."
        ),
        "anchor": "better = child_f <= fitness[:n_ev]",
    },
    {
        "phase": "recover",
        "title": "Stagnation recovery: random bit-flips",
        "body": (
            "After 3 generations without best-cost improvement, the worst "
            "half of the population gets about one random bit flipped per "
            "parameter. Working on the discrete encoding lets recovery jump "
            "to neighbouring grid cells that a continuous Gaussian step "
            "would rarely reach."
        ),
        "anchor": "np.argsort(fitness)[-n_t:]",
    },
    {
        "phase": "cmaes",
        "title": "CMA-ES warm-started from the archive",
        "body": (
            "The initial covariance is estimated from the scatter of the "
            "sorted archive points (blended 50/50 with an isotropic matrix "
            "of matching trace), so the first CMA-ES samples are already "
            "shaped like the promising region instead of a naive sphere."
        ),
        "anchor": "C_warm = np.cov(arc_xs.T)",
    },
    {
        "phase": "cmaes",
        "title": "CMA-ES sampling",
        "body": (
            "lambda offspring are sampled as mean + sigma * (z*D) @ B^T: "
            "standard normal draws z shaped by the eigendecomposition (B, D) "
            "of the covariance matrix and scaled by the global step size "
            "sigma. Samples are clipped to the bounds."
        ),
        "anchor": "standard_normal((lam, dim))",
    },
    {
        "phase": "cmaes",
        "title": "CMA-ES distribution update",
        "body": (
            "The best mu offspring define the new mean and, through "
            "evolution paths pc/ps, update the covariance (c1/cmu), the "
            "conjugate evolution path, and the step size sigma (cs/ds). This "
            "adapts both the shape and the scale of the search distribution."
        ),
        "anchor": "(1 - c1 - cmu) * C",
    },
    {
        "phase": "cmaes",
        "title": "IPOP restart: double the population",
        "body": (
            "When a run converges prematurely or stagnates, CMA-ES restarts "
            "from an archive point with half the step size and a doubled "
            "population size (up to 6 restarts) -- trading memory for a "
            "wider, more robust local search."
        ),
        "anchor": "restart += 1",
    },
    {
        "phase": "run",
        "title": "Main loop: alternate DE and recovery",
        "body": (
            "Phase 1 loops generations until 60% of the budget is spent. "
            "Stagnation is tracked with a 1e-12 tolerance on the best cost; "
            "three stagnant generations trigger the recovery operator."
        ),
        "anchor": "for g in range(1, self.max_gen + 1):",
    },
    {
        "phase": "run",
        "title": "Stagnation counter",
        "body": (
            "The counter resets only when the best cost improves by more "
            "than 1e-12. This makes recovery responsive to real plateaus "
            "while ignoring floating-point noise."
        ),
        "anchor": "if stag >= 3:",
    },
    {
        "phase": "run",
        "title": "Phase 2 handoff",
        "body": (
            "Whatever budget phase 1 did not consume goes to CMA-ES. If the "
            "DE phase converged early, CMA-ES receives a large remaining "
            "budget and can refine precisely around the best point."
        ),
        "anchor": "self._cmaes(self.max_evals - self.eval_count)",
    },
]

_BEATS_HYDE_QUB = [
    *_BEATS_HYDE_COMMON,
    {
        "phase": "eval",
        "title": "Evaluation: bookkeeping + sorted archive",
        "body": (
            "Identical to HyDE-bin's bookkeeping: best-so-far tracking, "
            "convergence history, and a cost-sorted archive that will seed "
            "the CMA-ES phase."
        ),
        "anchor": "cost = float(self.func(x))",
    },
    {
        "phase": "encode",
        "title": "Qubit observation: theta maps to x via sin^2",
        "body": (
            "Instead of a bitstring, each parameter is a qubit angle "
            "theta[i] in [0, pi/2], observed as x = lo + sin^2(theta) * "
            "width. Because sin^2 folds the space onto itself, theta and "
            "pi/2 - theta can represent mirrored locations -- the property "
            "exploited by tunneling."
        ),
        "anchor": "np.sin(theta) ** 2",
    },
    {
        "phase": "init",
        "title": "Latin Hypercube init in qubit space",
        "body": (
            "The population is initialized with LHS directly in theta space, "
            "then ordered with farthest-point reordering. Sampling in theta "
            "space biases initial observations toward the mid-regions of the "
            "bounds (sin^2 is steep near 0 and pi/2)."
        ),
        "anchor": "perm = self.rng.permutation(N)",
    },
    {
        "phase": "de",
        "title": "DE/current-to-best/1 in theta space",
        "body": (
            "The same DE operators as HyDE-bin but applied to qubit angles: "
            "mutation pulls each theta toward the best theta with per-"
            "individual F in U(0.5, 0.8) plus a random difference vector."
        ),
        "anchor": "best_t = theta[int(np.argmin(fitness))]",
    },
    {
        "phase": "de",
        "title": "Mutation in theta space",
        "body": (
            "mutant = theta_i + F*(best - theta_i) + F*(theta_r1 - theta_r2), "
            "clipped to [0, pi/2]. Operating on angles keeps all candidates "
            "inside the representable range before observation."
        ),
        "anchor": "mutants = theta + F[:, None]",
    },
    {
        "phase": "de",
        "title": "Binomial crossover",
        "body": (
            "Genes are mixed between parent and mutant with probability cr "
            "(0.9 when dim > 5), with one forced gene so children differ "
            "from their parents. Children are only observed (sin^2) at "
            "evaluation time."
        ),
        "anchor": "mask = self.rng.random((N, dim)) < cr",
    },
    {
        "phase": "de",
        "title": "Greedy selection",
        "body": (
            "Theta and fitness are updated only where the child is not "
            "worse, exactly like the real-valued variant."
        ),
        "anchor": "fitness[:n_ev] = np.where(better, child_f",
    },
    {
        "phase": "tunnel",
        "title": "Quantum tunneling: reflection through pi/4",
        "body": (
            "When DE stagnates, the worst half is reflected around pi/4: "
            "theta' = (1-s)*theta + s*(pi/2 - theta) with strengths s ramping "
            "0.2 to 1.0, plus small Gaussian noise. Since sin^2(pi/2 - t) = "
            "cos^2(t) = 1 - sin^2(t), reflection mirrors points through the "
            "center of the bounds -- a structured escape that systematically "
            "probes the symmetric middle region instead of random "
            "reinjection."
        ),
        "anchor": "(np.pi / 2 - theta[idx])",
    },
    {
        "phase": "cmaes",
        "title": "CMA-ES warm-started from the archive",
        "body": (
            "Phase 2 is shared with the other HyDE variants: covariance "
            "seeded from archive scatter, blended with an isotropic matrix."
        ),
        "anchor": "C_warm = np.cov(arc_xs.T)",
    },
    {
        "phase": "cmaes",
        "title": "CMA-ES sampling",
        "body": (
            "lambda offspring drawn from N(mean, sigma^2*C), shaped by the "
            "eigendecomposition of C and clipped to the bounds."
        ),
        "anchor": "standard_normal((lam, dim))",
    },
    {
        "phase": "cmaes",
        "title": "CMA-ES distribution update",
        "body": (
            "Weighted mean of the best mu offspring plus evolution-path "
            "updates adapt covariance and step size (c1/cmu/cc/cs/ds)."
        ),
        "anchor": "(1 - c1 - cmu) * C",
    },
    {
        "phase": "cmaes",
        "title": "IPOP restart: double the population",
        "body": (
            "Restarts halve sigma and double lambda, up to 6 times, to "
            "escape premature convergence."
        ),
        "anchor": "restart += 1",
    },
    {
        "phase": "run",
        "title": "Main loop: DE + stagnation-triggered tunneling",
        "body": (
            "Phase 1 alternates DE generations with tunneling every 3 "
            "stagnant generations, until 60% of the budget is consumed."
        ),
        "anchor": "for g in range(1, self.max_gen + 1):",
    },
    {
        "phase": "run",
        "title": "Stagnation counter",
        "body": (
            "Three generations without a >1e-12 best-cost improvement "
            "trigger the tunneling operator."
        ),
        "anchor": "if stag >= 3:",
    },
    {
        "phase": "run",
        "title": "Phase 2 handoff",
        "body": ("The remaining 40% budget is handed to IPOP-CMA-ES."),
        "anchor": "self._cmaes(self.max_evals - self.eval_count)",
    },
]

_BEATS_HYDE_CON = [
    *_BEATS_HYDE_COMMON,
    {
        "phase": "eval",
        "title": "Evaluation: bookkeeping + sorted archive",
        "body": (
            "Best-so-far tracking, convergence history, and a cost-sorted "
            "archive shared with the CMA-ES phase."
        ),
        "anchor": "cost = float(self.func(x))",
    },
    {
        "phase": "init",
        "title": "Latin Hypercube init + farthest-point reordering",
        "body": (
            "Same spread-then-reorder initialization as the other variants, "
            "but points stay real-valued: there is no encoding layer, so "
            "evaluation happens directly on the continuous vectors."
        ),
        "anchor": "perm = self.rng.permutation(N)",
    },
    {
        "phase": "de",
        "title": "Generation setup: best individual + DE parameters",
        "body": (
            "The best vector anchors the mutation direction; F per "
            "individual from U(0.5, 0.8), cr = 0.9 for dim > 5."
        ),
        "anchor": "best_x = pop[int(np.argmin(fitness))]",
    },
    {
        "phase": "de",
        "title": "DE/current-to-best/1 mutation (native continuous)",
        "body": (
            "mutant = x_i + F*(best - x_i) + F*(x_r1 - x_r2). HyDE-con is "
            "the ablation baseline: identical DE geometry to HyDE-bin but "
            "without any discrete encoding, isolating the effect of "
            "encoding on optimizer behaviour."
        ),
        "anchor": "mutants = pop + F[:, None]",
    },
    {
        "phase": "de",
        "title": "Binomial crossover",
        "body": (
            "Gene-wise mixing between parent and mutant with probability "
            "cr, one gene forced from the mutant."
        ),
        "anchor": "mask = self.rng.random((N, dim)) < cr",
    },
    {
        "phase": "de",
        "title": "Greedy selection",
        "body": ("Children replace parents only when not worse; the population never regresses."),
        "anchor": "better = child_f <= fitness[:n_ev]",
    },
    {
        "phase": "recover",
        "title": "Stagnation recovery: Gaussian perturbation",
        "body": (
            "The worst half is perturbed with Gaussian noise whose scale is "
            "the per-dimension population standard deviation (floored at "
            "1% of the bounds width). Recovery is therefore adaptive: wide "
            "populations scatter widely, converged populations take small "
            "local steps."
        ),
        "anchor": "np.argsort(fitness)[-n_t:]",
    },
    {
        "phase": "cmaes",
        "title": "CMA-ES warm-started from the archive",
        "body": (
            "Phase 2 identical to the other variants: covariance seeded from the archive scatter."
        ),
        "anchor": "C_warm = np.cov(arc_xs.T)",
    },
    {
        "phase": "cmaes",
        "title": "CMA-ES sampling",
        "body": (
            "lambda offspring drawn from N(mean, sigma^2*C), shaped by the "
            "eigendecomposition of C and clipped to the bounds."
        ),
        "anchor": "standard_normal((lam, dim))",
    },
    {
        "phase": "cmaes",
        "title": "CMA-ES distribution update",
        "body": (
            "Weighted mean of the best mu offspring plus evolution-path "
            "updates adapt covariance and step size."
        ),
        "anchor": "(1 - c1 - cmu) * C",
    },
    {
        "phase": "cmaes",
        "title": "IPOP restart: double the population",
        "body": ("Restarts halve sigma and double lambda, up to 6 times."),
        "anchor": "restart += 1",
    },
    {
        "phase": "run",
        "title": "Main loop: alternate DE and recovery",
        "body": (
            "Phase 1 loops until 60% of the budget; recovery fires after 3 "
            "stagnant generations (1e-12 improvement tolerance)."
        ),
        "anchor": "for g in range(1, self.max_gen + 1):",
    },
    {
        "phase": "run",
        "title": "Stagnation counter",
        "body": ("Counts generations without meaningful best-cost improvement."),
        "anchor": "if stag >= 3:",
    },
    {
        "phase": "run",
        "title": "Phase 2 handoff",
        "body": ("Remaining budget goes to IPOP-CMA-ES."),
        "anchor": "self._cmaes(self.max_evals - self.eval_count)",
    },
]

_BEATS_HYGO = [
    {
        "phase": "overview",
        "title": "HyGO: GA exploration + DSM exploitation",
        "body": (
            "HyGO alternates two stages every generation: an explorative "
            "stage where a genetic algorithm (elitism, tournament selection, "
            "crossover, bit mutation) generates N_explor individuals, and an "
            "exploitative stage where the Downhill Simplex Method refines "
            "around the top dim+1 individuals until the pool reaches "
            "N_explor + N_exploit. Everything is encoded in binary."
        ),
        "anchor": "class HyGO:",
    },
    {
        "phase": "init",
        "title": "Latin Hypercube initialization",
        "body": (
            "N_explor individuals are drawn with LHS (one jittered sample "
            "per stratum per dimension) for even coverage of the search "
            "space, then encoded and evaluated."
        ),
        "anchor": "perm = self.rng.permutation(n)",
    },
    {
        "phase": "encode",
        "title": "Binary encoding",
        "body": (
            "Each parameter maps to an Nb-bit integer (default 12 bits = "
            "4096 levels) on its bounds interval. All genetic operators "
            "act on this bit representation."
        ),
        "anchor": "idx = np.round(",
    },
    {
        "phase": "eval",
        "title": "Evaluation",
        "body": (
            "Costs are evaluated on the decoded vector; best-so-far "
            "bookkeeping appends to the convergence history used by the "
            "suite's metrics."
        ),
        "anchor": "cost = float(self.func(x))",
    },
    {
        "phase": "ga",
        "title": "Tournament selection",
        "body": (
            "NT candidates are drawn without replacement and ranked; the "
            "tournament returns the best with probability ps (0.5), "
            "otherwise walks down the ranking -- a tunable selection "
            "pressure between pure elitism and randomness."
        ),
        "anchor": "candidates = self.rng.choice(",
    },
    {
        "phase": "ga",
        "title": "Single-point crossover",
        "body": (
            "Two tournament winners exchange bit tails at one random "
            "crossover point, recombining building blocks of both parents."
        ),
        "anchor": "self.rng.integers(1, len(c1))",
    },
    {
        "phase": "ga",
        "title": "Bit-flip mutation",
        "body": (
            "Each bit flips with probability 1/len (expected one flip per "
            "chromosome), with an at-least-one-flip guarantee so mutation "
            "never silently becomes replication."
        ),
        "anchor": "= self.rng.random(n) < pm_bit",
    },
    {
        "phase": "sort",
        "title": "Sort + trim: keep the best N",
        "body": (
            "After every stage the pool is sorted by cost and truncated. "
            "This truncation selection is what turns the generate-many "
            "operators into actual progress on the population."
        ),
        "anchor": "np.argsort(pop_costs)",
    },
    {
        "phase": "dsm",
        "title": "DSM setup: centroid + worst point",
        "body": (
            "The simplex is re-sorted each iteration; c is the centroid of "
            "all points except the worst. All DSM moves (reflect/expand/"
            "contract) are computed from c and the worst point."
        ),
        "anchor": "np.mean(sx[:-1]",
    },
    {
        "phase": "dsm",
        "title": "Reflection (with expansion fallback)",
        "body": (
            "xr = c + (c - worst) mirrors the worst point through the "
            "centroid. If the reflection is not good enough to be accepted "
            "directly, the code first tries expansion (see below) when the "
            "reflected point beats the best, otherwise falls through to "
            "contraction."
        ),
        "anchor": "xr = np.clip(c + (c - worst)",
    },
    {
        "phase": "dsm",
        "title": "Expansion",
        "body": (
            "When the reflection beats the current best, HyGO stretches "
            "further: xe = c + 2*(c - worst). The farthest of reflection/"
            "expansion wins, accelerating progress along promising "
            "directions."
        ),
        "anchor": "xe = np.clip(c + 2 * (c - worst)",
    },
    {
        "phase": "dsm",
        "title": "Contraction",
        "body": (
            "When reflection is worse than the second-worst point, the "
            "worst point is contracted halfway toward the centroid -- a "
            "shrink of the step length in that direction."
        ),
        "anchor": "xc = np.clip(c + 0.5 * (worst - c)",
    },
    {
        "phase": "dsm",
        "title": "Shrink toward the best",
        "body": (
            "If even contraction fails, the whole simplex (except the best "
            "point) collapses halfway toward the best point -- a global "
            "reduction of the simplex volume indicating the search is in a "
            "very local basin."
        ),
        "anchor": "new_sx = [sx[0]]",
    },
    {
        "phase": "dsm",
        "title": "Escape stagnation: random perturbation",
        "body": (
            "Three consecutive no-change attempts inject a random point at "
            "10% of the bounds width around the centroid, preventing the "
            "simplex from collapsing onto a single point forever."
        ),
        "anchor": "0.1 * (self.hi - self.lo)",
    },
    {
        "phase": "dsm",
        "title": "R2 degeneracy correction",
        "body": (
            "A sliding window of recent points is checked for "
            "near-collinearity/coplanarity via SVD: if the last Nf points "
            "fit a hyperplane with R^2 > 0.98, a corrective step orthogonal "
            "to that hyperplane is injected, un-degenerating the simplex."
        ),
        "anchor": "np.linalg.svd(pts_c",
    },
    {
        "phase": "run",
        "title": "Initialization + sort (lines 1-3)",
        "body": (
            "N_explor LHS individuals are generated, evaluated and sorted; "
            "this sorted pool is the simplex source for the first "
            "exploitative pass."
        ),
        "anchor": "if self.use_lhs:",
    },
    {
        "phase": "exploit",
        "title": "g=1: exploitation only (lines 4-10)",
        "body": (
            "The first generation runs no GA stage: DSM immediately expands "
            "the sorted pool from N_explor to N_explor + N_exploit "
            "individuals, then sort + trim keeps the best."
        ),
        "anchor": "g = 1: exploitative stage only",
    },
    {
        "phase": "run",
        "title": "Main loop (lines 12-27)",
        "body": (
            "Each generation from 2 to NG runs the explorative GA stage "
            "followed by the exploitative DSM stage, until convergence or "
            "the evaluation budget is exhausted."
        ),
        "anchor": "Main loop: g = 2",
    },
    {
        "phase": "ga",
        "title": "Elitism",
        "body": (
            "The best Ne chromosomes are copied unchanged into the new "
            "generation; their fitness is already known, so elites are "
            "never re-evaluated (this protects budget)."
        ),
        "anchor": "new_chroms = []",
    },
    {
        "phase": "ga",
        "title": "GA reproduction: crossover / mutation / replication",
        "body": (
            "For each remaining child a single random roll decides the "
            "operator: crossover (p=Pc, two tournament parents), mutation "
            "(p=Pm, one tournament parent), otherwise replication. "
            "Default Pc=0.55, Pm=0.45 makes replication rare (Pr=0)."
        ),
        "anchor": "r = self.rng.random()",
    },
    {
        "phase": "ga",
        "title": "Evaluate offspring, sort, trim to N_explor",
        "body": (
            "All non-elite children are evaluated, the pool is sorted and "
            "trimmed back to N_explor -- the explorative stage's answer to "
            "balancing new samples against quality."
        ),
        "anchor": "new_costs.append(self.evaluate(new_x[i]))",
    },
    {
        "phase": "exploit",
        "title": "Exploitative stage (lines 19-25)",
        "body": (
            "DSM runs on the top dim+1 pool members until N_ind reaches "
            "N_explor + N_exploit (Ncycle individuals per pass), then sort "
            "+ trim keeps the best. The simplex is rebuilt from the "
            "current elite pool every time, so local search always starts "
            "from the freshest good region."
        ),
        "anchor": "Exploitative stage (lines 19",
    },
    {
        "phase": "run",
        "title": "Convergence check (line 12)",
        "body": (
            "After each generation the convergence criterion is evaluated; "
            "HyGO stops immediately once it is met, saving the remaining "
            "budget."
        ),
        "anchor": "Line 12: while not convergence",
    },
]

ALGO_BEATS: dict[str, list[dict[str, str]]] = {
    "hyde_bin": _BEATS_HYDE_BIN,
    "hyde_qub": _BEATS_HYDE_QUB,
    "hyde_con": _BEATS_HYDE_CON,
    "hygo": _BEATS_HYGO,
}


# -- Resolution helpers ---------------------------------------------------------


def resolve_beats(source: str, algo_key: str) -> list[dict[str, Any]]:
    """Resolve curated beats for one algorithm against its source text.

    Anchors that do not match anything are dropped silently; overlapping
    (same-line) anchors keep the first occurrence.
    """
    """Resolve curated beats for one algorithm against its source text."""
    lines = source.splitlines()
    found: list[tuple[int, dict[str, Any]]] = []
    seen: set[int] = set()
    for spec in ALGO_BEATS[algo_key]:
        start = None
        for i, line in enumerate(lines, start=1):
            if spec["anchor"] in line:
                start = i
                break
        if start is None or start in seen:
            continue
        seen.add(start)
        found.append((start, dict(spec)))
    found.sort(key=lambda t: t[0])
    total = len(lines)
    beats: list[dict[str, Any]] = []
    for j, (start, spec) in enumerate(found):
        end = found[j + 1][0] - 1 if j + 1 < len(found) else total
        beats.append(
            {
                "phase": spec["phase"],
                "title": spec["title"],
                "body": spec["body"],
                "start_line": start,
                "end_line": end,
            }
        )
    return beats


def _beat_index_for_line(beats: list[dict[str, Any]], lineno: int) -> int:
    """Index of the beat whose range contains ``lineno`` (-1 if none)."""
    lo, hi = 0, len(beats) - 1
    ans = -1
    while lo <= hi:
        mid = (lo + hi) // 2
        if beats[mid]["start_line"] <= lineno:
            ans = mid
            lo = mid + 1
        else:
            hi = mid - 1
    return ans


# -- Tracer ---------------------------------------------------------------------


# -- Trace payload encoding -------------------------------------------------------
#
# The trace travels over the WebView IPC as JSON; raw int arrays of ~100k
# entries produce multi-hundred-KB responses that stress WebKitGTK (rope
# string / GC pathologies have been observed to wedge the web process).
# Instead, each event stream is delta-encoded as int16 (all deltas are far
# below 2^15: line numbers < file length, eval counts are monotonic, function
# and beat indices are small), zlib-compressed and base64-encoded. The
# frontend inflates with the standard DecompressionStream("deflate") API.


def _pack_i16_delta(values: list[int]) -> str:
    """Delta-encode ``values`` as int16, zlib-compress, base64-encode."""
    prev = 0
    deltas = array("h")
    for v in values:
        d = int(v) - prev
        if d < -32768 or d > 32767:
            raise SimulationError("event delta out of int16 range")
        deltas.append(d)
        prev = int(v)
    compressed = zlib.compress(deltas.tobytes(), 9)
    return base64.b64encode(compressed).decode("ascii")


def unpack_events(payload: dict[str, str]) -> tuple[list[int], list[int], list[int], list[int]]:
    """Inverse of the packing in ``run_simulation_trace`` (used by tests)."""
    import struct

    def unpack(field: str) -> list[int]:
        raw = zlib.decompress(base64.b64decode(payload[field]))
        deltas = struct.unpack(f"<{len(raw) // 2}h", raw)
        out: list[int] = []
        acc = 0
        for d in deltas:
            acc += d
            out.append(acc)
        return out

    return (
        unpack("func"),
        unpack("line"),
        unpack("eval_count"),
        unpack("beat"),
    )


def run_simulation_trace(
    algo_key: str,
    fname: str,
    seed: int = 0,
    max_evals: int = DEFAULT_EVALS,
    pop_size: int = DEFAULT_POP,
) -> dict[str, Any]:
    """Run one small simulation of ``algo_key`` on a 2D scenario and return
    a replayable trace dict."""
    if algo_key not in ALGO_MODULES:
        raise SimulationError(f"unknown algorithm: {algo_key!r}")
    if fname not in FUNCTIONS:
        raise SimulationError(f"unknown benchmark function: {fname!r}")
    max_evals = min(max(MIN_EVALS, int(max_evals)), MAX_EVALS)
    pop_size = min(max(MIN_POP, int(pop_size)), MAX_POP)
    seed = int(seed)
    if seed < 0:
        raise SimulationError("seed must be non-negative")

    lo, hi = get_bounds(fname, MAX_DIM)

    module_name, class_name = ALGO_MODULES[algo_key]
    module = importlib.import_module(module_name)
    algo_cls = getattr(module, class_name)
    source = inspect.getsource(module)
    beats = resolve_beats(source, algo_key)
    target_file = module.__file__

    func_names: list[str] = []
    func_ids: dict[int, int] = {}
    ev_func: list[int] = []
    ev_line: list[int] = []
    ev_eval: list[int] = []
    ev_beat: list[int] = []
    snapshots: list[dict[str, Any]] = []
    last_eval = {"v": 0}
    pending_eval = {"v": False}
    truncated = {"v": False}

    def _func_idx(code_obj: Any) -> int:
        key = id(code_obj)
        idx = func_ids.get(key)
        if idx is None:
            idx = len(func_names)
            func_names.append(code_obj.co_name)
            func_ids[key] = idx
        return idx

    def _record_eval_snapshot() -> None:
        best_x = getattr(algo, "best_x", None)
        snapshots.append(
            {
                "kind": "eval",
                # trace event index at which this snapshot was taken; the
                # frontend keys gen-snapshot lookups on it so intra-phase
                # stages (LHS draw vs reorder vs evaluated pool) replay in
                # exact code order even at equal eval counts
                "event_idx": len(ev_func),
                "eval_count": int(algo.eval_count),
                "best_cost": float(algo.best_cost),
                "best_x": ([float(best_x[0]), float(best_x[1])] if best_x is not None else None),
                "phase": None,
                "gen": None,
                "positions": None,
                "ops": None,
            }
        )

    def _progress_hook(snap: dict[str, Any]) -> None:
        snapshots.append(
            {
                "kind": "gen",
                "event_idx": len(ev_func),
                "eval_count": int(snap.get("eval_count", algo.eval_count)),
                "best_cost": float(snap.get("best_cost", algo.best_cost)),
                "best_x": snap.get("best_pos"),
                "phase": snap.get("phase"),
                "gen": snap.get("gen"),
                "positions": snap.get("positions"),
                "ops": snap.get("ops"),
            }
        )

    def _record_line(func_idx: int, lineno: int) -> None:
        if len(ev_func) >= MAX_TRACE_EVENTS:
            truncated["v"] = True
            return
        ec = int(algo.eval_count)
        ev_func.append(func_idx)
        ev_line.append(lineno)
        ev_eval.append(ec)
        ev_beat.append(_beat_index_for_line(beats, lineno))
        if ec != last_eval["v"]:
            last_eval["v"] = ec
            # best_cost bookkeeping happens a line or two after the
            # increment; defer the snapshot until the cost is usable.
            pending_eval["v"] = True
        elif pending_eval["v"] and algo.best_cost < float("inf"):
            pending_eval["v"] = False
            _record_eval_snapshot()

    def _tracer(frame: Any, event: str, arg: Any) -> Any:
        if frame.f_code.co_filename != target_file:
            return None
        if event in ("call", "line", "return"):
            _record_line(_func_idx(frame.f_code), frame.f_lineno)
        return _tracer

    func = FUNCTIONS[fname]
    algo_kwargs: dict[str, Any] = dict(
        fname=fname,
        dim=MAX_DIM,
        max_evals=max_evals,
        seed=seed,
        progress_hook=_progress_hook,
    )
    if algo_key == "hygo":
        nexplor = max(1, pop_size * 2 // 3)
        algo_kwargs.update(
            Nb=12,
            NG=500,
            Nexplor=nexplor,
            Nexploit=max(1, pop_size - nexplor),
        )
    else:
        algo_kwargs.update(pop_size=pop_size, max_gen=500)

    algo = algo_cls(func=func, **algo_kwargs)

    prev_trace = sys.gettrace()
    try:
        sys.settrace(_tracer)
        result = algo.run()
    finally:
        sys.settrace(prev_trace)
    if pending_eval["v"] and algo.best_cost < float("inf"):
        _record_eval_snapshot()

    return {
        "algo_key": algo_key,
        "fname": fname,
        "dim": MAX_DIM,
        "seed": seed,
        "max_evals": max_evals,
        "pop_size": pop_size,
        "lo": [float(lo[0]), float(lo[1])],
        "hi": [float(hi[0]), float(hi[1])],
        "source": source,
        "func_names": func_names,
        "n_events": len(ev_func),
        "events_payload": {
            "func": _pack_i16_delta(ev_func),
            "line": _pack_i16_delta(ev_line),
            "eval_count": _pack_i16_delta(ev_eval),
            "beat": _pack_i16_delta(ev_beat),
        },
        "beats": beats,
        "snapshots": snapshots,
        "result": {
            "best_cost": float(result["best_cost"]),
            "best_x": (
                [float(result["best_x"][0]), float(result["best_x"][1])]
                if result["best_x"] is not None
                else None
            ),
            "evals": int(result["evals"]),
            "conv_gen": result["conv_gen"],
        },
        "truncated": truncated["v"],
    }
