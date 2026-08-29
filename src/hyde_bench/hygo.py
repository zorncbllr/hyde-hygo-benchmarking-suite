import numpy as np

from hyde_bench.benchmarks import converged, get_bounds


class HyGO:
    """
    Faithful implementation of HyGO from the paper.
    - Binary encoding (Nb bits per parameter)
    - Fixed Nexplor, Nexploit
    - Reactive R2 degeneracy correction
    - DSM local search
    - Tournament selection

    Pseudocode (Algorithm 1):
      Initialisation  (lines 1–3):
        Generate N_explor individuals, evaluate, sort.
      g=1 exploitative-only pass (lines 4–10):
        Run DSM until N_ind reaches N_explor + N_exploit, sort.
      Main loop g = 2…N_g (lines 12–27):
        Explorative stage (lines 13–18):
          GA (elitism / crossover / mutation) on current pool → N_explor new
          individuals, evaluate, sort → trim to N_explor.
        Exploitative stage (lines 19–25):
          DSM on top dim+1 individuals until N_ind reaches
          N_explor + N_exploit, sort → keep N_explor + N_exploit.
    """

    def __init__(self, func, fname, dim,
                 Nb=12, NG=50,
                 Nexplor=70, Nexploit=30,
                 Ncycle=1,
                 Pc=0.55, Pm=0.45, Pr=0.0,
                 NT=7, Ne=1,
                 ps=0.5,
                 use_lhs=True,
                 max_evals=50000,
                 seed=None,
                 progress_hook=None):
        self.func      = func
        self.fname     = fname
        self.dim       = dim
        self.Nb        = Nb
        self.NG        = NG
        self.Nexplor   = Nexplor
        self.Nexploit  = Nexploit
        self.Ncycle    = Ncycle
        self.use_lhs   = use_lhs
        self.Pc        = Pc
        self.Pm        = Pm
        self.Pr        = Pr
        self.NT        = NT
        self.Ne        = Ne
        self.ps        = ps
        self.max_evals = max_evals
        self.rng       = np.random.default_rng(seed)

        self.lo, self.hi = get_bounds(fname, dim)

        self.n_vals = 2 ** Nb   # 4096 discrete values per parameter

        self.eval_count   = 0
        self.best_cost    = np.inf
        self.best_x       = None
        self.cost_history = []   # best cost at every evaluation
        self.gen_best     = []   # best cost recorded after each stage
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


    # ── Latin Hypercube Sampling ──────────────────────────────────────────────

    def _lhs_sample(self, n):
        """Generate n samples via Latin Hypercube Sampling (line 1 pseudocode)."""
        samples = np.zeros((n, self.dim))
        for d in range(self.dim):
            perm = self.rng.permutation(n)
            samples[:, d] = (perm + self.rng.random(n)) / n
        return self.lo + samples * (self.hi - self.lo)


    # ── Encoding ─────────────────────────────────────────────────────────────

    def encode(self, x):
        """Real vector → binary chromosome."""
        idx = np.round(
            (x - self.lo) / (self.hi - self.lo) * (self.n_vals - 1)
        ).astype(int)
        idx = np.clip(idx, 0, self.n_vals - 1)
        chrom = np.zeros(self.dim * self.Nb, dtype=np.int8)
        for i, v in enumerate(idx):
            bits = [(v >> b) & 1 for b in range(self.Nb - 1, -1, -1)]
            chrom[i * self.Nb:(i + 1) * self.Nb] = bits
        return chrom

    def decode(self, chrom):
        """Binary chromosome → real vector."""
        x = np.zeros(self.dim)
        for i in range(self.dim):
            bits = chrom[i * self.Nb:(i + 1) * self.Nb]
            val  = int(''.join(str(b) for b in bits), 2)
            x[i] = self.lo[i] + val / (self.n_vals - 1) * (self.hi[i] - self.lo[i])
        return x


    # ── Evaluation ───────────────────────────────────────────────────────────

    def evaluate(self, x):
        cost = float(self.func(x))
        self.eval_count += 1
        if cost < self.best_cost:
            self.best_cost = cost
            self.best_x    = x.copy()
        self.cost_history.append(self.best_cost)
        return cost


    # ── Tournament selection ──────────────────────────────────────────────────

    def tournament_select(self, pop_chroms, pop_costs):
        candidates = self.rng.choice(
            len(pop_costs), size=min(self.NT, len(pop_costs)), replace=False
        )
        ranked = sorted(candidates, key=lambda i: pop_costs[i])
        for idx in ranked:
            if self.rng.random() < self.ps:
                return pop_chroms[idx]
        return pop_chroms[ranked[-1]]


    # ── Crossover ────────────────────────────────────────────────────────────

    def crossover(self, c1, c2):
        """Single-point crossover."""
        child = c1.copy()
        pt    = self.rng.integers(1, len(c1))
        child[pt:] = c2[pt:]
        return child


    # ── Mutation ─────────────────────────────────────────────────────────────

    def mutate(self, chrom):
        """Bit-flip mutation with at-least-one-flip guarantee."""
        child  = chrom.copy()
        n      = len(child)
        pm_bit = 1.0 / n
        mask   = self.rng.random(n) < pm_bit
        if not mask.any():
            mask[self.rng.integers(n)] = True
        child[mask] ^= 1
        return child


    # ── DSM local search ─────────────────────────────────────────────────────

    def run_dsm(self, simplex_x, simplex_costs, budget):
        """
        Downhill Simplex Method with HyGO's reactive R2 degeneracy correction.
        Runs until `budget` new individuals have been generated or the eval
        budget is exhausted.
        """
        N  = self.dim
        sx = [x.copy() for x in simplex_x]
        sc = list(simplex_costs)

        new_individuals    = []
        attempts_no_change = 0

        # Sliding window for R2 degeneracy check
        Nf            = max(N + 2, 5)
        recent_points = list(simplex_x)

        while len(new_individuals) < budget and self.eval_count < self.max_evals:

            # Sort simplex
            order = np.argsort(sc)
            sx    = [sx[i] for i in order]
            sc    = [sc[i] for i in order]

            c              = np.mean(sx[:-1], axis=0)   # centroid (exclude worst)
            worst          = sx[-1]
            J_worst        = sc[-1]
            J_best         = sc[0]
            J_second_worst = sc[-2]

            improved = False

            # Reflection
            xr = np.clip(c + (c - worst), self.lo, self.hi)
            Jr = self.evaluate(xr)
            new_individuals.append((xr, Jr))
            recent_points.append(xr)

            if Jr < J_best:
                # Expansion
                xe = np.clip(c + 2 * (c - worst), self.lo, self.hi)
                Je = self.evaluate(xe)
                new_individuals.append((xe, Je))
                recent_points.append(xe)
                if Je < Jr:
                    sx[-1] = xe; sc[-1] = Je
                else:
                    sx[-1] = xr; sc[-1] = Jr
                improved = True

            elif Jr < J_second_worst:
                sx[-1] = xr; sc[-1] = Jr
                improved = True

            else:
                # Contraction
                xc = np.clip(c + 0.5 * (worst - c), self.lo, self.hi)
                Jc = self.evaluate(xc)
                new_individuals.append((xc, Jc))
                recent_points.append(xc)

                if Jc < J_worst:
                    sx[-1] = xc; sc[-1] = Jc
                    improved = True
                else:
                    # Shrink
                    new_sx = [sx[0]]
                    new_sc = [sc[0]]
                    for j in range(1, N + 1):
                        xs = np.clip(sx[0] + 0.5 * (sx[j] - sx[0]), self.lo, self.hi)
                        Js = self.evaluate(xs)
                        new_individuals.append((xs, Js))
                        recent_points.append(xs)
                        new_sx.append(xs)
                        new_sc.append(Js)
                    sx       = new_sx
                    sc       = new_sc
                    improved = True

            if not improved:
                attempts_no_change += 1
                if attempts_no_change >= 3:
                    # Random perturbation to escape stagnation
                    xrand = np.clip(
                        c + 0.1 * (self.hi - self.lo) * self.rng.standard_normal(N),
                        self.lo, self.hi
                    )
                    Jr2 = self.evaluate(xrand)
                    new_individuals.append((xrand, Jr2))
                    recent_points.append(xrand)
                    if Jr2 < sc[-1]:
                        sx[-1] = xrand; sc[-1] = Jr2
                    attempts_no_change = 0
            else:
                attempts_no_change = 0

            # R2 degeneracy check — inject correction orthogonal to degenerate
            # hyperplane if the last Nf points are nearly collinear/coplanar.
            if len(recent_points) >= Nf and N > 1:
                pts   = np.array(recent_points[-Nf:])
                pts_c = pts - pts.mean(axis=0)
                if pts_c.shape[0] > 1:
                    _, _, Vt   = np.linalg.svd(pts_c, full_matrices=False)
                    normal     = Vt[-1]
                    proj       = pts_c @ normal
                    ss_res     = np.sum(proj ** 2)
                    ss_tot     = np.sum(pts_c ** 2)
                    R2         = 1 - ss_res / (ss_tot + 1e-30)
                    if R2 > 0.98:
                        step  = (self.hi - self.lo).min() / (self.n_vals - 1)
                        xcorr = np.clip(
                            c + step * normal * self.rng.choice([-1, 1]),
                            self.lo, self.hi
                        )
                        Jcorr = self.evaluate(xcorr)
                        new_individuals.append((xcorr, Jcorr))
                        recent_points.append(xcorr)
                        if Jcorr < sc[-1]:
                            sx[-1] = xcorr; sc[-1] = Jcorr

        return new_individuals


    # ── Sorting helpers ───────────────────────────────────────────────────────

    def _sort_pop(self, pop_x, pop_costs, pop_chroms):
        order      = np.argsort(pop_costs)
        pop_x      = [pop_x[i]      for i in order]
        pop_costs  = [pop_costs[i]  for i in order]
        pop_chroms = [pop_chroms[i] for i in order]
        return pop_x, pop_costs, pop_chroms

    def _trim(self, pop_x, pop_costs, pop_chroms, n):
        return pop_x[:n], pop_costs[:n], pop_chroms[:n]


    # ── Main run ──────────────────────────────────────────────────────────────

    def run(self):
        # ── Initialisation: lines 1–3 ────────────────────────────────────────
        # Line 1: Generate N_explor individuals randomly or with LHS
        pop_x     = []
        pop_costs = []
        if self.use_lhs:
            init_xs = self._lhs_sample(self.Nexplor)
        else:
            init_xs = [self.lo + self.rng.random(self.dim) * (self.hi - self.lo)
                       for _ in range(self.Nexplor)]

        for x in init_xs:
            pop_x.append(x)
            pop_costs.append(self.evaluate(x))

        pop_chroms = [self.encode(x) for x in pop_x]
        pop_x, pop_costs, pop_chroms = self._sort_pop(pop_x, pop_costs, pop_chroms)

        self.gen_best.append(self.best_cost)
        self._emit_progress('init', 0, pop_x)
        conv_gen = None

        # ── g = 1: exploitative stage only (lines 4–10) ──────────────────────
        # Line 4: N_ind^1 = N_explor
        # Line 5: while N_ind^1 < (N_explor + N_exploit) do
        # Line 6-7: generate + evaluate individual with local search
        # Line 8: N_ind^1 := N_ind^1 + N_cycle
        if self.eval_count < self.max_evals:
            N_ind = self.Nexplor
            while N_ind < (self.Nexplor + self.Nexploit) and self.eval_count < self.max_evals:
                dsm_inds = self.run_dsm(
                    pop_x[:self.dim + 1],
                    pop_costs[:self.dim + 1],
                    self.Ncycle
                )
                for x, c in dsm_inds:
                    pop_x.append(x)
                    pop_costs.append(c)
                    pop_chroms.append(self.encode(x))
                N_ind += self.Ncycle

            # Line 10: sort, keep N_explor + N_exploit
            pop_x, pop_costs, pop_chroms = self._sort_pop(pop_x, pop_costs, pop_chroms)
            pop_x, pop_costs, pop_chroms = self._trim(
                pop_x, pop_costs, pop_chroms, self.Nexplor + self.Nexploit
            )

        self.gen_best.append(self.best_cost)
        self._emit_progress('exploit', 1, pop_x)

        # ── Main loop: g = 2 … N_g (lines 12–27) ────────────────────────────
        for gen in range(1, self.NG):
            if self.eval_count >= self.max_evals:
                break

            # -- Explorative stage (lines 13-18) ---------------------------------
            # Lines 13-16: for i=1 to N_explor -- generate ALL N_explor
            # individuals first via GA operators, with NO evaluation yet.
            # Line 17: evaluate fitness of each individual.
            # Line 18: sort population.
            new_chroms = []
            new_x      = []

            # Elitism (line 15: "elitism"): carry best Ne chromosomes unchanged.
            # Their fitness is already known -- no re-evaluation needed.
            for i in range(min(self.Ne, len(pop_chroms))):
                new_chroms.append(pop_chroms[i].copy())
                new_x.append(pop_x[i].copy())

            # Lines 13-16: generate remaining N_explor - Ne children.
            # Tournament selection draws from the PARENT pool (pop_chroms,
            # pop_costs) matching pseudocode where no new evals have happened.
            for _ in range(len(new_chroms), self.Nexplor):
                r = self.rng.random()
                if r < self.Pc:
                    # Crossover (line 15)
                    p1          = self.tournament_select(pop_chroms, pop_costs)
                    p2          = self.tournament_select(pop_chroms, pop_costs)
                    child_chrom = self.crossover(p1, p2)
                elif r < self.Pc + self.Pm:
                    # Mutation (line 15)
                    p           = self.tournament_select(pop_chroms, pop_costs)
                    child_chrom = self.mutate(p)
                else:
                    # Replication (line 15)
                    child_chrom = self.tournament_select(pop_chroms, pop_costs).copy()
                new_chroms.append(child_chrom)
                new_x.append(self.decode(child_chrom))

            # Line 17: evaluate fitness of each individual r=1,...,N_explor.
            # Elites reuse their known cost (not re-evaluated).
            elite_count = min(self.Ne, len(pop_costs))
            new_costs   = list(pop_costs[:elite_count])
            for i in range(elite_count, len(new_x)):
                new_costs.append(self.evaluate(new_x[i]))
                if self.eval_count >= self.max_evals:
                    break

            # Line 18: sort, trim to N_explor
            pop_x, pop_costs, pop_chroms = self._sort_pop(
                new_x[:len(new_costs)], new_costs, new_chroms[:len(new_costs)]
            )
            pop_x, pop_costs, pop_chroms = self._trim(
                pop_x, pop_costs, pop_chroms, self.Nexplor
            )

            if self.eval_count >= self.max_evals:
                break

            # ── Exploitative stage (lines 19–25) ─────────────────────────────
            # Line 19: N_ind^g = N_explor
            # Line 20: while N_ind^g < (N_explor + N_exploit) do
            # Line 21-22: generate + evaluate individual with local search
            # Line 23: N_ind^g := N_ind^g + N_cycle
            N_ind = self.Nexplor
            while N_ind < (self.Nexplor + self.Nexploit) and self.eval_count < self.max_evals:
                dsm_inds = self.run_dsm(
                    pop_x[:self.dim + 1],
                    pop_costs[:self.dim + 1],
                    self.Ncycle
                )
                for x, c in dsm_inds:
                    pop_x.append(x)
                    pop_costs.append(c)
                    pop_chroms.append(self.encode(x))
                N_ind += self.Ncycle

            # Line 25: sort, keep N_explor + N_exploit
            pop_x, pop_costs, pop_chroms = self._sort_pop(pop_x, pop_costs, pop_chroms)
            pop_x, pop_costs, pop_chroms = self._trim(
                pop_x, pop_costs, pop_chroms, self.Nexplor + self.Nexploit
            )

            self.gen_best.append(self.best_cost)
            self._emit_progress('de', gen + 1, pop_x)

            # Line 12: while not convergence and g < N_g
            if conv_gen is None and converged(self.fname, self.best_cost, self.dim):
                conv_gen = gen + 1
                break  # stop as soon as convergence criterion is met

        return {
            'best_cost':    self.best_cost,
            'best_x':       self.best_x,
            'evals':        self.eval_count,
            'conv_gen':     conv_gen,
            'gen_best':     self.gen_best,
            'cost_history': self.cost_history,
        }