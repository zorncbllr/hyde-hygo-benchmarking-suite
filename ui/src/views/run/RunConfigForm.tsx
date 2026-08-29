import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Play, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { pyInvokeValidated } from "@/lib/api";
import {
  BENCH_FUNCTIONS,
  CLI_DEFAULTS,
  CLI_TEST_CASES,
  pongResponseSchema,
  type TestCase,
  benchmarkConfigSchema,
  startBenchmarkResponseSchema,
} from "@/lib/schemas";
import { formatCompact } from "@/lib/formatters";
import { useLiveStore } from "@/stores/live";
import type { z } from "zod";

type ConfigForm = z.infer<typeof benchmarkConfigSchema>;

const DEFAULT_FORM: ConfigForm = {
  label: `experiment ${new Date().toISOString().slice(0, 10)}`,
  test_cases: CLI_TEST_CASES,
  n_runs: CLI_DEFAULTS.nRuns,
  max_evals: CLI_DEFAULTS.maxEvals,
  alpha: CLI_DEFAULTS.alpha,
  seed_base: CLI_DEFAULTS.seedBase,
  algo_params: {
    hyde: { ...CLI_DEFAULTS.hyde },
    hygo: { ...CLI_DEFAULTS.hygo },
  },
};

function scenarioKey(tc: TestCase) {
  return `${tc.fname}_${tc.dim}`;
}

export default function RunConfigForm() {
  const [ipcStatus, setIpcStatus] = useState<"idle" | "ok" | "error">("idle");
  const [ipcMessage, setIpcMessage] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customFn, setCustomFn] = useState<string>(BENCH_FUNCTIONS[0]);
  const [customDim, setCustomDim] = useState(2);

  const form = useForm<ConfigForm>({
    resolver: zodResolver(benchmarkConfigSchema),
    defaultValues: DEFAULT_FORM,
    mode: "onBlur",
  });
  const testCases = form.watch("test_cases");

  async function checkBackend() {
    try {
      const res = await pyInvokeValidated("ping", pongResponseSchema, {
        payload: "hello",
      });
      setIpcMessage(res.message);
      setIpcStatus("ok");
    } catch (err) {
      setIpcMessage(String(err));
      setIpcStatus("error");
    }
  }
  function toggleScenario(tc: TestCase) {
    const current = form.getValues("test_cases");
    const has = current.some((t) => t.fname === tc.fname && t.dim === tc.dim);
    const next = has
      ? current.filter((t) => !(t.fname === tc.fname && t.dim === tc.dim))
      : [...current, tc];
    form.setValue("test_cases", next, { shouldValidate: true });
  }

  function applyPreset(preset: "cli" | "2d" | "scalable" | "none") {
    let next: TestCase[] = [];
    if (preset === "cli") next = CLI_TEST_CASES;
    if (preset === "2d") next = CLI_TEST_CASES.filter((t) => t.dim === 2);
    if (preset === "scalable")
      next = CLI_TEST_CASES.filter((t) =>
        [
          "ackley",
          "sphere",
          "rastrigin",
          "rosenbrock",
          "styblinski_tang",
        ].includes(t.fname),
      );
    form.setValue("test_cases", next, { shouldValidate: true });
  }

  function addCustom() {
    const dim = Number(customDim);
    if (
      Number.isInteger(dim) &&
      dim >= 2 &&
      !testCases.some((t) => t.fname === customFn && t.dim === dim)
    ) {
      form.setValue("test_cases", [...testCases, { fname: customFn, dim }], {
        shouldValidate: true,
      });
    }
    setCustomOpen(false);
  }

  async function start() {
    const valid = await form.trigger();
    if (!valid) {
      toast.error("Fix configuration errors before starting");
      return;
    }
    setStarting(true);
    try {
      const res = await pyInvokeValidated(
        "start_benchmark",
        startBenchmarkResponseSchema,
        { config: form.getValues() },
      );
      // switch to the live monitor immediately; totals arrive via events
      useLiveStore.setState({ status: "running", runId: res.run_id });
      toast.success(`Benchmark started (${res.run_id.slice(0, 8)})`);
    } catch (err) {
      toast.error(`Failed to start: ${String(err)}`);
    } finally {
      setStarting(false);
    }
  }

  const totalRuns = (form.watch("n_runs") ?? 0) * 4 * (testCases?.length ?? 0);
  const scenariosSelected = testCases?.length ?? 0;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">New experiment</h1>
          <p className="text-sm text-muted-foreground">
            Configure and launch benchmark experiments. Defaults match the CLI
            exactly.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={checkBackend}>
            Check IPC
          </Button>
          {ipcMessage && (
            <Badge variant={ipcStatus === "ok" ? "default" : "destructive"}>
              {ipcStatus === "ok" ? "backend online" : "backend error"}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Scenario selection */}
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              Scenarios
              <Badge variant="secondary" className="ml-2">
                {scenariosSelected} selected
              </Badge>
            </CardTitle>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => applyPreset("cli")}
              >
                CLI default 20
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => applyPreset("2d")}
              >
                2D only
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => applyPreset("scalable")}
              >
                Scalable
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => applyPreset("none")}
              >
                Clear
              </Button>
              <Dialog open={customOpen} onOpenChange={setCustomOpen}>
                <DialogTrigger
                  render={
                    <Button size="sm" variant="outline">
                      <Plus className="h-4 w-4" />
                    </Button>
                  }
                />
                <DialogContent className="sm:max-w-sm">
                  <DialogHeader>
                    <DialogTitle>Add custom scenario</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label>Function</Label>
                      <select
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                        value={customFn}
                        onChange={(e) => setCustomFn(e.target.value)}
                      >
                        {BENCH_FUNCTIONS.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Dimension (min 2)</Label>
                      <Input
                        type="number"
                        min={2}
                        max={100}
                        value={customDim}
                        onChange={(e) => setCustomDim(Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={addCustom}>Add</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {CLI_TEST_CASES.map((tc) => {
                const checked = testCases?.some(
                  (t) => t.fname === tc.fname && t.dim === tc.dim,
                );
                return (
                  <label
                    key={scenarioKey(tc)}
                    className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent/50"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleScenario(tc)}
                    />
                    <span className="truncate">{tc.fname}</span>
                    <Badge variant="outline" className="ml-auto">
                      {tc.dim}D
                    </Badge>
                  </label>
                );
              })}
              {(testCases ?? [])
                .filter(
                  (t) =>
                    !CLI_TEST_CASES.some(
                      (c) => c.fname === t.fname && c.dim === t.dim,
                    ),
                )
                .map((tc) => (
                  <label
                    key={scenarioKey(tc)}
                    className="flex items-center gap-2 rounded-md border border-primary/50 bg-primary/5 px-3 py-2 text-sm"
                  >
                    <Checkbox
                      checked
                      onCheckedChange={() => toggleScenario(tc)}
                    />
                    <span className="truncate">{tc.fname}</span>
                    <Badge variant="outline" className="ml-auto">
                      {tc.dim}D
                    </Badge>
                  </label>
                ))}
            </div>
            {form.formState.errors.test_cases && (
              <p className="mt-2 text-sm text-destructive">
                {form.formState.errors.test_cases.message}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Parameters */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Parameters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Label</Label>
              <Input {...form.register("label")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Runs per algo</Label>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  {...form.register("n_runs", { valueAsNumber: true })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Max evals</Label>
                <Input
                  type="number"
                  min={1000}
                  step={1000}
                  {...form.register("max_evals", { valueAsNumber: true })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Alpha</Label>
                <Input
                  type="number"
                  step={0.005}
                  min={0.001}
                  max={0.2}
                  {...form.register("alpha", { valueAsNumber: true })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Seed base</Label>
                <Input
                  type="number"
                  min={0}
                  {...form.register("seed_base", { valueAsNumber: true })}
                />
              </div>
            </div>

            <Separator />

            <details className="text-sm">
              <summary className="cursor-pointer font-medium">
                HyDE parameters
              </summary>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>max_gen</Label>
                  <Input
                    type="number"
                    {...form.register("algo_params.hyde.max_gen", {
                      valueAsNumber: true,
                    })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>phase_split</Label>
                  <Input
                    type="number"
                    step={0.05}
                    {...form.register("algo_params.hyde.phase_split", {
                      valueAsNumber: true,
                    })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Nb (bits)</Label>
                  <Input
                    type="number"
                    {...form.register("algo_params.hyde.Nb", {
                      valueAsNumber: true,
                    })}
                  />
                </div>
              </div>
            </details>

            <details className="text-sm">
              <summary className="cursor-pointer font-medium">
                HyGO parameters
              </summary>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {(
                  [
                    "Nb",
                    "NG",
                    "Nexplor",
                    "Nexploit",
                    "Ne",
                    "ps",
                    "Pc",
                    "Pm",
                    "Pr",
                  ] as const
                ).map((k) => (
                  <div key={k} className="space-y-1.5">
                    <Label>{k}</Label>
                    <Input
                      type="number"
                      step="any"
                      {...form.register(`algo_params.hygo.${k}`, {
                        valueAsNumber: true,
                      })}
                    />
                  </div>
                ))}
              </div>
            </details>

            {Object.keys(form.formState.errors).length > 0 && (
              <p className="text-sm text-destructive">
                Validation errors present; check highlighted fields.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="flex items-center justify-between pt-6">
          <div className="text-sm text-muted-foreground">
            Estimated total:{" "}
            <span className="font-medium text-foreground">
              {formatCompact(totalRuns)} runs
            </span>{" "}
            ({scenariosSelected} scenarios x 4 algorithms x{" "}
            {form.watch("n_runs")} runs)
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => form.reset(DEFAULT_FORM)}
              title="Reset to CLI defaults"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset
            </Button>
            <Button onClick={start} disabled={starting}>
              <Play className="mr-2 h-4 w-4" />
              {starting ? "Starting..." : "Start benchmark"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
