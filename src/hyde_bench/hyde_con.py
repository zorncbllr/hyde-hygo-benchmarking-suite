import bisect

import numpy as np

from hyde_bench.benchmarks import converged, get_bounds


class HyDECon:
    """
    HyDE-con: Continuous (real-valued) encoding variant of Hybrid Differential Evolution.

    Phase 1 — DE/current-to-best/1/bin with direct continuous encoding (60% budget)
      Parameters are represented directly as real-valued vectors.
      DE mutation operates natively on continuous values.
      Stagnation recovery: Gaussian perturbation on worst N/2.

    Phase 2 — IPOP-CMA-ES with warm covariance (40% budget)
      Initial covariance seeded from archive scatter.
      Population doubles on each restart (IPOP).
    """

    def __init__(self, func, fname, dim, pop_size=None, max_gen=50,
                 max_evals=50000, phase_split=0.60, seed=None,
                 progress_hook=None, **kwargs):
        self.func = func
        self.fname = fname
        self.dim = dim
        self.pop_size = pop_size or max(50, 3 * dim)
        self.max_gen = max_gen
        self.max_evals = max_evals
        self.rng = np.random.default_rng(seed)
        self.lo, self.hi = get_bounds(fname, dim)
        self.width = self.hi - self.lo
        self._p1_budget = int(np.floor(max_evals * phase_split))
        self.eval_count = 0
        self.best_cost = np.inf
        self.best_x = None
        self.cost_history = []
        self.gen_best = []
        self._arc = []
        self._arc_max = max(dim + 2, 30)
        self.progress_hook = progress_hook

    def _emit_progress(self, phase, gen, positions=None):
        """Emit a read-only snapshot to the progress hook, if installed.

        Never mutates algorithm state and does not touch the RNG, so runs
        with ``progress_hook=None`` are byte-identical to uninstrumented code.
        """
        hook = self.progress_hook
        if hook is None:
            return
        snap = {
            'phase': phase,
            'gen': gen,
            'eval_count': int(self.eval_count),
            'best_cost': float(self.best_cost),
            'gen_best': float(self.gen_best[-1]) if self.gen_best else None,
            'gen_best_tail': [float(c) for c in self.gen_best[-64:]],
            'best_pos': (
                [float(self.best_x[0]), float(self.best_x[1])]
                if self.best_x is not None and self.dim == 2
                else None
            ),
        }
        if positions is not None and self.dim == 2:
            p = np.asarray(positions, dtype=float)[:200]
            snap['positions'] = [[float(px), float(py)] for px, py in p]
        else:
            snap['positions'] = None
        hook(snap)

    # -- Evaluation ---------------------------------------------------------

    def _eval(self, x):
        cost = float(self.func(x))
        self.eval_count += 1
        if cost < self.best_cost:
            self.best_cost = cost
            self.best_x = x.copy()
        self.cost_history.append(self.best_cost)
        cs = [c for c, _ in self._arc]
        pos = bisect.bisect_left(cs, cost)
        self._arc.insert(pos, (cost, x.copy()))
        if len(self._arc) > self._arc_max:
            self._arc.pop()
        return cost

    def _eval_pop(self, xs):
        xs = np.clip(xs, self.lo, self.hi)
        return np.array([self._eval(x) for x in xs])

    # -- LHS init with farthest-point reordering ----------------------------

    def _init_pop(self, N):
        pop = np.zeros((N, self.dim))
        for d in range(self.dim):
            perm = self.rng.permutation(N)
            pop[:, d] = self.lo[d] + (perm + self.rng.random(N)) / N * self.width[d]

        # Farthest-point reordering
        if N > 4:
            sel = [0]
            dists = np.full(N, np.inf)
            for _ in range(N - 1):
                d2 = np.sum((pop - pop[sel[-1]]) ** 2, axis=1)
                dists = np.minimum(dists, d2)
                sel.append(int(np.argmax(dists)))
            pop = pop[sel]

        fitness = self._eval_pop(pop)
        return pop, fitness

    # -- DE/current-to-best/1/bin in continuous space ------------------------

    def _de_gen(self, pop, fitness):
        N, dim = pop.shape
        best_x = pop[int(np.argmin(fitness))]

        F = 0.5 + 0.3 * self.rng.random(N)
        cr = 0.9 if dim > 5 else 0.5

        r1 = self.rng.integers(0, N, N)
        r2 = self.rng.integers(0, N, N)
        for i in range(N):
            while r1[i] == i:
                r1[i] = self.rng.integers(0, N)
            while r2[i] == i or r2[i] == r1[i]:
                r2[i] = self.rng.integers(0, N)

        mutants = pop + F[:, None] * (best_x - pop) \
                      + F[:, None] * (pop[r1] - pop[r2])
        mutants = np.clip(mutants, self.lo, self.hi)

        mask = self.rng.random((N, dim)) < cr
        mask[np.arange(N), self.rng.integers(0, dim, N)] = True
        children = np.where(mask, mutants, pop)

        n_ev = min(N, self.max_evals - self.eval_count)
        if n_ev <= 0:
            return pop, fitness

        child_f = self._eval_pop(children[:n_ev])
        better = child_f <= fitness[:n_ev]
        pop[:n_ev] = np.where(better[:, None], children[:n_ev], pop[:n_ev])
        fitness[:n_ev] = np.where(better, child_f, fitness[:n_ev])
        return pop, fitness

    # -- Stagnation recovery: Gaussian perturbation -------------------------

    def _recover(self, pop, fitness):
        N = len(fitness)
        n_t = max(1, N // 2)
        worst = np.argsort(fitness)[-n_t:]

        # Compute perturbation scale from population spread
        sig = np.std(pop, axis=0)
        sig = np.maximum(sig, self.width * 0.01)

        for idx in worst:
            pop[idx] = pop[idx] + sig * self.rng.standard_normal(self.dim)
            pop[idx] = np.clip(pop[idx], self.lo, self.hi)

        n_ev = min(n_t, self.max_evals - self.eval_count)
        if n_ev > 0:
            fitness[worst[:n_ev]] = self._eval_pop(pop[worst[:n_ev]])
        return pop, fitness

    # -- IPOP-CMA-ES with warm covariance -----------------------------------

    def _cmaes(self, budget):
        dim = self.dim
        if not self._arc:
            return

        lam_base = max(4 + int(3 * np.log(dim)), min(4 * dim, 40))

        arc_xs = np.array([x for _, x in self._arc])
        C_warm = None
        if len(arc_xs) > dim + 1:
            C_warm = np.cov(arc_xs.T)
            tr = max(np.trace(C_warm), 1e-30)
            C_warm = 0.5 * C_warm + 0.5 * np.eye(dim) * (tr / dim)

        global_sig = float(np.clip(
            np.mean(np.std(arc_xs, axis=0)) if len(arc_xs) > 1
            else np.min(self.width) * 0.2,
            1e-6, np.max(self.width) * 0.5))

        used, lam, restart = 0, lam_base, 0

        while used < budget and self.eval_count < self.max_evals and restart < 6:
            mu = lam // 2
            raw_w = np.log(mu + 0.5) - np.log(np.arange(1, mu + 1))
            w = raw_w / raw_w.sum()
            mueff = 1.0 / np.sum(w ** 2)
            cs = (mueff + 2) / (dim + mueff + 5)
            ds = 1 + 2 * max(0, np.sqrt((mueff - 1) / (dim + 1)) - 1) + cs
            chi = np.sqrt(dim) * (1 - 1 / (4 * dim) + 1 / (21 * dim ** 2))
            cc = (4 + mueff / dim) / (dim + 4 + 2 * mueff / dim)
            c1 = 2 / ((dim + 1.3) ** 2 + mueff)
            cmu = min(1 - c1,
                      2 * (mueff - 2 + 1 / mueff) / ((dim + 2) ** 2 + mueff))

            idx = min(restart, len(self._arc) - 1)
            mean = self._arc[idx][1].copy()
            sig = max(global_sig * (0.5 ** restart),
                      float(np.min(self.width)) * 1e-3)
            C = C_warm.copy() if (C_warm is not None and restart == 0) \
                else np.eye(dim)
            pc = np.zeros(dim)
            ps = np.zeros(dim)
            gen = 0

            while used < budget and self.eval_count < self.max_evals:
                try:
                    ev, B = np.linalg.eigh(C)
                    ev = np.maximum(ev, 1e-20)
                    D = np.sqrt(ev)
                except np.linalg.LinAlgError:
                    C = np.eye(dim); D = np.ones(dim); B = np.eye(dim)

                if min(budget - used, self.max_evals - self.eval_count) < lam:
                    break

                Z = self.rng.standard_normal((lam, dim))
                X = np.clip(mean + sig * (Z * D) @ B.T, self.lo, self.hi)
                costs = self._eval_pop(X)
                used += lam; gen += 1

                order = np.argsort(costs)
                X_sel = X[order[:mu]]
                mean_old = mean.copy()
                mean = w @ X_sel

                invsqC = B @ np.diag(1.0 / D) @ B.T
                st = (mean - mean_old) / sig
                ps = ((1 - cs) * ps
                      + np.sqrt(cs * (2 - cs) * mueff) * (invsqC @ st))
                hs = (np.linalg.norm(ps)
                      / np.sqrt(max(1e-300, 1 - (1 - cs) ** (2 * gen)))
                      / chi) < 1.4 + 2 / (dim + 1)
                pc = ((1 - cc) * pc
                      + hs * np.sqrt(cc * (2 - cc) * mueff) * st)
                artmp = (X_sel - mean_old) / sig
                C = ((1 - c1 - cmu) * C
                     + c1 * (np.outer(pc, pc)
                             + (1 - hs) * cc * (2 - cc) * C)
                     + cmu * (w[:, None] * artmp).T @ artmp)
                sig *= np.exp((cs / ds) * (np.linalg.norm(ps) / chi - 1))
                sig = float(np.clip(sig, 1e-12, np.max(self.width)))

                if sig < 1e-11 or not np.isfinite(sig) \
                        or not np.all(np.isfinite(C)):
                    break

            restart += 1
            lam = min(lam * 2, budget - used)
            if lam < 4:
                break

    # -- Main run -----------------------------------------------------------

    def run(self):
        N = self.pop_size
        conv_gen = None

        pop, fitness = self._init_pop(N)
        self.gen_best.append(self.best_cost)
        self._emit_progress('init', 0, pop)

        stag = 0
        prev_best = self.best_cost

        for g in range(1, self.max_gen + 1):
            if self.eval_count >= min(self._p1_budget, self.max_evals):
                break

            pop, fitness = self._de_gen(pop, fitness)
            if self.eval_count >= self.max_evals:
                break

            if self.best_cost < prev_best - 1e-12:
                stag = 0; prev_best = self.best_cost
            else:
                stag += 1

            if stag >= 3:
                pop, fitness = self._recover(pop, fitness)
                stag = 0
                if self.eval_count >= self.max_evals:
                    break

            self.gen_best.append(self.best_cost)
            self._emit_progress('de', g, pop)
            if conv_gen is None and converged(self.fname, self.best_cost, self.dim):
                conv_gen = g

        if self.eval_count < self.max_evals and self._arc:
            self._cmaes(self.max_evals - self.eval_count)
            self.gen_best.append(self.best_cost)
            self._emit_progress('cmaes', None, None)

        while len(self.gen_best) <= self.max_gen:
            self.gen_best.append(self.best_cost)
        if conv_gen is None and converged(self.fname, self.best_cost, self.dim):
            conv_gen = self.max_gen

        return {
            'best_cost': self.best_cost,
            'best_x': self.best_x,
            'evals': self.eval_count,
            'conv_gen': conv_gen,
            'gen_best': self.gen_best,
            'cost_history': self.cost_history,
        }
