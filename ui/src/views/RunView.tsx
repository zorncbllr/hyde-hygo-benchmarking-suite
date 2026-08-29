import { useLiveStore } from "@/stores/live";
import { useBenchmarkEvents } from "@/hooks/useBenchmarkEvents";
import RunConfigForm from "./run/RunConfigForm";
import LiveMonitor from "./run/LiveMonitor";

/**
 * Run page: shows the experiment configuration while idle, and switches to
 * the live monitor (with cancel / view-results / new-experiment controls)
 * as soon as a benchmark is started.
 */
export default function RunView() {
  useBenchmarkEvents();
  const status = useLiveStore((s) => s.status);
  const showMonitor =
    status === "running" ||
    status === "completed" ||
    status === "cancelled" ||
    status === "error";

  return showMonitor ? <LiveMonitor /> : <RunConfigForm />;
}
