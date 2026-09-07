import { useMemo, type ReactNode } from "react";
import {
  ALGO_KEYS,
  ALGO_LABELS,
  type AlgoKey,
  type AnalysisSummary,
  type ScenarioResultRow,
} from "@/lib/schemas";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const HYDE_KEYS: AlgoKey[] = ["hyde_bin", "hyde_qub", "hyde_con"];

/** Python-style exponent formatting: two-digit zero-padded exponent. */
function pyExp(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  return v.toExponential(2).replace(/e([+-])(\d)$/, "e$10$2");
}

function signedPyExp(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  return (v >= 0 ? "+" : "") + pyExp(v);
}

function signedFixed(v: number | null | undefined, digits = 3): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  return (v >= 0 ? "+" : "") + v.toFixed(digits);
}

function fixed(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "n/a";
  return v.toFixed(digits);
}

function interpretCliffsDelta(d: number): string {
  const ad = Math.abs(d);
  if (ad >= 0.474) return "large";
  if (ad >= 0.33) return "medium";
  if (ad >= 0.147) return "small";
  return "negligible";
}

function Section({
  id,
  title,
  narrative,
  children,
}: {
  id: string;
  title: string;
  narrative: string;
  children?: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">
        ({id}) {title}
      </h3>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {narrative}
      </p>
      {children}
    </section>
  );
}

function YesNo({ value }: { value: boolean | null }) {
  return <>{value ? "Yes" : "No"}</>;
}

function finiteMean(values: Array<number | null>): number {
  const vals = (values ?? []).filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
}

/**
 * Statistical analyses rendered in the same structure as the exported DOCX
 * report: sections (a)-(e) with the same narrative text and table shapes.
 */
export function AnalysesReport({
  analysis,
  scenarioResults,
  nRuns,
}: {
  analysis: AnalysisSummary;
  scenarioResults: ScenarioResultRow[];
  nRuns: number;
}) {
  const fa = analysis.friedman_objective_error;
  const cochran = analysis.cochrans_q;
  const fw = analysis.friedman_wall_time;
  const margins = analysis.margin_vs_hygo;
  const scaling = analysis.scaling;

  // (a) wins by mean objective error from per-scenario Kruskal-Wallis
  const kruskalWins = useMemo(() => {
    const wins: Record<string, number> = {};
    let nSig = 0;
    for (const kr of analysis.kruskal_per_scenario) {
      if (kr.sig) nSig += 1;
      if (kr.best_algo in ALGO_LABELS) {
        wins[kr.best_algo] = (wins[kr.best_algo] ?? 0) + 1;
      }
    }
    const best = Object.keys(wins).length
      ? Object.entries(wins).sort((a, b) => b[1] - a[1])[0][0]
      : "hygo";
    return { wins, nSig, best };
  }, [analysis.kruskal_per_scenario]);

  // (b) mean convergence per algorithm from scenario rows
  const convStats = useMemo(() => {
    const meanConv = {} as Record<AlgoKey, number>;
    const n100 = {} as Record<AlgoKey, number>;
    for (const ak of ALGO_KEYS) {
      const rows = scenarioResults.filter((r) => r.algo_key === ak);
      meanConv[ak] =
        rows.length > 0
          ? rows.reduce((s, r) => s + r.conv_pct, 0) / rows.length
          : 0;
      n100[ak] = rows.filter((r) => r.conv_pct === 100.0).length;
    }
    const best = ALGO_KEYS.reduce((a, b) =>
      meanConv[b] > meanConv[a] ? b : a,
    );
    return { meanConv, n100, best };
  }, [scenarioResults]);

  // (d) win/tie counts and per-variant effect statistics
  const marginStats = useMemo(() => {
    const hygoWins = margins.filter(
      (m) => m.sig && (m.direction ?? "").includes("HyGO better"),
    ).length;
    const variantWins = margins.filter(
      (m) =>
        m.sig &&
        m.hyde_key in ALGO_LABELS &&
        !(m.direction ?? "").includes("HyGO better"),
    ).length;
    const ties = margins.filter((m) => !m.sig).length;
    const perVariant = HYDE_KEYS.map((hk) => {
      const rows = margins.filter((m) => m.hyde_key === hk);
      const ds = rows
        .map((m) => m.cliffs_delta)
        .filter((d): d is number => d !== null && Number.isFinite(d));
      const meanD = finiteMean(ds);
      return {
        hyde_key: hk,
        label: ALGO_LABELS[hk],
        meanD,
        nLarge: ds.filter((d) => Math.abs(d) >= 0.474).length,
        nMedium: ds.filter((d) => Math.abs(d) >= 0.33 && Math.abs(d) < 0.474)
          .length,
        nSmall: ds.filter((d) => Math.abs(d) >= 0.147 && Math.abs(d) < 0.33)
          .length,
        nNegligible: ds.filter((d) => Math.abs(d) < 0.147).length,
      };
    });
    return { hygoWins, variantWins, ties, perVariant };
  }, [margins]);

  const nScenarios = useMemo(
    () => new Set(margins.map((m) => m.key)).size,
    [margins],
  );

  // (e) per-algorithm scaling aggregates
  const scalingStats = useMemo(() => {
    if (scaling.length === 0) return null;
    const rowsByAlgo = ALGO_KEYS.map((ak) => {
      const rows = scaling.filter((r) => r.algo_key === ak);
      const nDeg = rows.filter(
        (r) => r.sig && r.direction === "degraded",
      ).length;
      const finiteDegs = rows
        .map((r) => r.degradation_ratio)
        .filter((d): d is number => d !== null && Number.isFinite(d));
      return {
        algo_key: ak,
        label: ALGO_LABELS[ak],
        n: rows.length,
        nDeg,
        meanCv25: finiteMean(rows.map((r) => r.cv_25d)),
        meanDeg: finiteMean(finiteDegs),
      };
    });
    const mostConsistent = rowsByAlgo.reduce((a, b) =>
      b.meanCv25 < a.meanCv25 ? b : a,
    );
    return { rowsByAlgo, mostConsistent };
  }, [scaling]);

  const narrativeA = `The Friedman test (block design, ${fa.n_benchmarks} benchmarks) yielded \u03c7\u00b2 = ${fixed(fa.chi2)}, p = ${pyExp(fa.p_friedman)} (${fa.sig ? "significant" : "not significant"}). ${ALGO_LABELS[fa.best_algo as AlgoKey] ?? fa.best_algo} achieved the lowest mean rank (${fixed(fa.mean_ranks[fa.best_algo])}). Per-scenario Kruskal-Wallis tests found significant differences on ${kruskalWins.nSig} of ${analysis.kruskal_per_scenario.length} scenarios. By mean objective error, ${ALGO_LABELS[kruskalWins.best as AlgoKey] ?? kruskalWins.best} won ${kruskalWins.wins[kruskalWins.best] ?? 0} scenarios.`;

  const narrativeB = `Cochran\u2019s Q test yielded Q = ${fixed(cochran.Q_stat)}, p = ${pyExp(cochran.p_value)} (${cochran.sig ? "significant" : "not significant"}), indicating that convergence rates ${cochran.sig ? "differ significantly" : "do not differ significantly"} across algorithms. ${ALGO_LABELS[convStats.best]} achieved the highest mean convergence rate (${convStats.meanConv[convStats.best].toFixed(1)}%).`;

  const narrativeC = `The Friedman test on median wall-clock times yielded \u03c7\u00b2 = ${fixed(fw.chi2)}, p = ${pyExp(fw.p_friedman)} (${fw.sig ? "significant" : "not significant"}). ${ALGO_LABELS[fw.fastest as AlgoKey] ?? fw.fastest} was the fastest overall (${fixed(fw.grand_means_ms[fw.fastest], 0)} ms mean). ${ALGO_KEYS.filter(
    (k) => k !== "hygo",
  )
    .map((ak) => {
      const spd = fw.speedup_vs_hygo[ak] ?? NaN;
      return `${ALGO_LABELS[ak]} is ${fixed(spd)}x ${spd > 1 ? "faster" : "slower"} than HyGO.`;
    })
    .join(" ")}`;

  const narrativeD = `Wilcoxon rank-sum tests with Cliff\u2019s delta and bootstrap 95% CIs were applied for each HyDE variant against HyGO across all ${nScenarios} scenarios. The HyDE variants collectively achieved ${marginStats.variantWins} significant wins vs HyGO\u2019s ${marginStats.hygoWins}; ${marginStats.ties} showed no significant difference. ${marginStats.perVariant
    .map(
      (v) =>
        `${v.label}: mean Cliff\u2019s d = ${signedFixed(v.meanD)} (${interpretCliffsDelta(v.meanD)}), ${v.nLarge} large effects.`,
    )
    .join(" ")}`;

  const narrativeE = scalingStats
    ? `${scalingStats.rowsByAlgo
        .map(
          (r) =>
            `${r.label}: significant degradation on ${r.nDeg}/${r.n} functions, mean CV at 25D = ${fixed(r.meanCv25, 4)}, mean degradation ratio = ${fixed(r.meanDeg)}.`,
        )
        .join(
          " ",
        )} Most consistent at 25D: ${scalingStats.mostConsistent.label}.`
    : null;

  return (
    <div className="space-y-8">
      <Section id="a" title="Mean Final Objective Error" narrative={narrativeA}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pair</TableHead>
              <TableHead className="text-right">Rank Diff</TableHead>
              <TableHead className="text-right">CD</TableHead>
              <TableHead>Significant</TableHead>
              <TableHead>Direction</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fa.nemenyi.map((np_) => (
              <TableRow key={np_.pair}>
                <TableCell>{np_.pair}</TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {fixed(np_.rank_diff, 3)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {fixed(np_.critical_diff, 3)}
                </TableCell>
                <TableCell>
                  <YesNo value={np_.significant ?? false} />
                </TableCell>
                <TableCell>{np_.direction ?? "n/a"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Scenario</TableHead>
              <TableHead className="text-right">H-stat</TableHead>
              <TableHead className="text-right">p-value</TableHead>
              <TableHead>Sig.</TableHead>
              <TableHead>Best</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {analysis.kruskal_per_scenario.map((kr) => (
              <TableRow key={kr.key}>
                <TableCell>{kr.key}</TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {fixed(kr.h_stat)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {pyExp(kr.p_kruskal)}
                </TableCell>
                <TableCell>
                  <YesNo value={kr.sig} />
                </TableCell>
                <TableCell>
                  {ALGO_LABELS[kr.best_algo as AlgoKey] ?? kr.best_algo}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section id="b" title="Convergence Rate" narrative={narrativeB}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Scenario</TableHead>
              {ALGO_KEYS.map((k) => (
                <TableHead key={k} className="text-right">
                  {ALGO_LABELS[k]}
                </TableHead>
              ))}
              <TableHead className="text-right">{"\u03c7\u00b2"}</TableHead>
              <TableHead className="text-right">p</TableHead>
              <TableHead>Sig.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {analysis.chi2_convergence.map((cr) => (
              <TableRow key={cr.key}>
                <TableCell>{cr.key}</TableCell>
                {ALGO_KEYS.map((ak) => (
                  <TableCell key={ak} className="text-right font-mono text-xs">
                    {cr.conv_counts[ak] ?? 0}/{nRuns}
                  </TableCell>
                ))}
                <TableCell className="text-right font-mono text-xs">
                  {fixed(cr.chi2)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {pyExp(cr.p_value)}
                </TableCell>
                <TableCell>
                  <YesNo value={cr.sig} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-sm text-muted-foreground">
          {ALGO_KEYS.map((ak) => (
            <span key={ak} className="mr-4 inline-block">
              {ALGO_LABELS[ak]}: mean convergence ={" "}
              {convStats.meanConv[ak].toFixed(1)}%, 100% convergence on{" "}
              {convStats.n100[ak]}/
              {scenarioResults.filter((r) => r.algo_key === ak).length}{" "}
              scenarios.
            </span>
          ))}
        </p>
      </Section>

      <Section id="c" title="Wall-Clock Cost per Run" narrative={narrativeC}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Algorithm</TableHead>
              <TableHead className="text-right">Grand Mean (ms)</TableHead>
              <TableHead className="text-right">Speedup vs HyGO</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ALGO_KEYS.map((ak) => (
              <TableRow key={ak}>
                <TableCell>{ALGO_LABELS[ak]}</TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {fixed(fw.grand_means_ms[ak], 0)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {fixed(fw.speedup_vs_hygo[ak])}x
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section
        id="d"
        title="Practically Meaningful Margin vs HyGO"
        narrative={narrativeD}
      >
        <div className="max-h-[360px] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Scenario</TableHead>
                <TableHead>Variant</TableHead>
                <TableHead className="text-right">U</TableHead>
                <TableHead className="text-right">p</TableHead>
                <TableHead>Sig.</TableHead>
                <TableHead className="text-right">Cliff{"\u2019"}s d</TableHead>
                <TableHead className="text-right">CI lo</TableHead>
                <TableHead className="text-right">CI hi</TableHead>
                <TableHead>Direction</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {margins.map((m) => (
                <TableRow key={`${m.key}_${m.hyde_key}`}>
                  <TableCell>{m.key}</TableCell>
                  <TableCell>{m.hyde_label}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {m.u_stat.toFixed(0)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {pyExp(m.p_value)}
                  </TableCell>
                  <TableCell>
                    <YesNo value={m.sig} />
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {signedFixed(m.cliffs_delta)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {signedPyExp(m.bootstrap_ci_lo)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {signedPyExp(m.bootstrap_ci_hi)}
                  </TableCell>
                  <TableCell>{m.direction ?? "n/a"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Comparison</TableHead>
              <TableHead className="text-right">Mean d</TableHead>
              <TableHead className="text-right">Large</TableHead>
              <TableHead className="text-right">Medium</TableHead>
              <TableHead className="text-right">Small</TableHead>
              <TableHead className="text-right">Negligible</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {marginStats.perVariant.map((v) => (
              <TableRow key={v.hyde_key}>
                <TableCell>{v.label} vs HyGO</TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {signedFixed(v.meanD)}
                </TableCell>
                <TableCell className="text-right">{v.nLarge}</TableCell>
                <TableCell className="text-right">{v.nMedium}</TableCell>
                <TableCell className="text-right">{v.nSmall}</TableCell>
                <TableCell className="text-right">{v.nNegligible}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      {scalingStats && narrativeE && (
        <Section
          id="e"
          title="Dimensionality Scaling: 2D vs 25D"
          narrative={narrativeE}
        >
          <div className="max-h-[360px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Function</TableHead>
                  <TableHead>Algorithm</TableHead>
                  <TableHead className="text-right">U</TableHead>
                  <TableHead className="text-right">p</TableHead>
                  <TableHead>Sig.</TableHead>
                  <TableHead className="text-right">d</TableHead>
                  <TableHead className="text-right">CV 2D</TableHead>
                  <TableHead className="text-right">CV 25D</TableHead>
                  <TableHead className="text-right">Deg. Ratio</TableHead>
                  <TableHead>Dir.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scaling.map((row) => (
                  <TableRow key={`${row.fname}_${row.algo_key}`}>
                    <TableCell>{row.fname}</TableCell>
                    <TableCell>{row.algo_label}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {row.u_stat.toFixed(0)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {pyExp(row.p_value)}
                    </TableCell>
                    <TableCell>
                      <YesNo value={row.sig} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {signedFixed(row.cliffs_delta)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {fixed(row.cv_2d, 4)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {fixed(row.cv_25d, 4)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {row.degradation_ratio === null
                        ? "inf"
                        : row.degradation_ratio.toFixed(2)}
                    </TableCell>
                    <TableCell>{row.direction ?? "n/a"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>
      )}
    </div>
  );
}
