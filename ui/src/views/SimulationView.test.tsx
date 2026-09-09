import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SimulationView from "./SimulationView";
import type { SimulationTraceLoaded } from "@/lib/simTraceCodec";
import { makeTrace } from "@/test/simTrace";
import type { SurfaceResponse } from "@/lib/schemas";

vi.mock("@/lib/api", () => ({
  pyInvokeValidated: vi.fn(),
  subscribeValidated: vi.fn(() => Promise.resolve(() => undefined)),
}));

// three.js/WebGL and echarts canvas are unavailable in jsdom
vi.mock("@/components/simulation/SimScene", () => ({
  default: ({
    maximized,
    onToggleMaximize,
  }: {
    maximized?: boolean;
    onToggleMaximize?: () => void;
  }) => (
    <div data-testid="sim-scene-mock">
      {onToggleMaximize && (
        <button
          type="button"
          title={maximized ? "Minimize" : "Maximize"}
          onClick={onToggleMaximize}
        />
      )}
    </div>
  ),
}));
vi.mock("@/components/simulation/SimConvergenceChart", () => ({
  default: () => <div data-testid="sim-chart-mock" />,
}));

import { pyInvokeValidated } from "@/lib/api";

vi.mock("@/lib/simTraceCache", () => ({
  fetchTrace: vi.fn(),
  resetTraceCacheForTests: vi.fn(),
}));

import { fetchTrace, resetTraceCacheForTests } from "@/lib/simTraceCache";

const mockInvoke = vi.mocked(pyInvokeValidated);
const mockFetchTrace = vi.mocked(fetchTrace);

const surface: SurfaceResponse = {
  xs: [0, 1],
  ys: [0, 1],
  zs: [
    [0, 1],
    [1, 0],
  ],
  lo: [-5, -5],
  hi: [5, 5],
};

beforeEach(() => {
  vi.mocked(resetTraceCacheForTests).mockClear();
  mockInvoke.mockReset();
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "get_surface") return Promise.resolve(surface);
    return Promise.reject(new Error(`unexpected command: ${cmd}`));
  });
  mockFetchTrace.mockReset();
  mockFetchTrace.mockImplementation((req) =>
    Promise.resolve(
      makeTrace({
        algo_key: req.algo_key,
        fname: req.fname,
      }) as SimulationTraceLoaded,
    ),
  );
});

describe("SimulationView", () => {
  it("runs a traced simulation on mount and renders the workspace", async () => {
    render(<SimulationView />);
    await waitFor(() => {
      expect(mockFetchTrace).toHaveBeenCalledWith({
        algo_key: "hyde_bin",
        fname: "sphere",
        seed: 0,
        max_evals: 400,
        pop_size: 24,
      });
    });

    // trace playback UI appears
    await waitFor(() => {
      expect(screen.getByText("DE mutation")).toBeInTheDocument();
    });
    expect(screen.getByTestId("sim-scene-mock")).toBeInTheDocument();
    expect(screen.getByText("run structure")).toBeInTheDocument();
    expect(screen.getByText(/step 1\/6/)).toBeInTheDocument();

    // right sidebar shows the actual source with the current line
    expect(screen.getByText("source of truth")).toBeInTheDocument();
    expect(screen.getByText("line 5")).toBeInTheDocument();

    // outcome strip registers the finished simulation
    const strip = screen.getByText("outcomes this session").closest("div");
    expect(strip).not.toBeNull();
    expect(within(strip!.parentElement!).getByText(/1\.000e/)).toBeTruthy();
  });

  it("switching algorithm tabs re-runs the simulation with the new key", async () => {
    render(<SimulationView />);
    await waitFor(() => {
      expect(screen.getByText("outcomes this session")).toBeInTheDocument();
    });
    mockFetchTrace.mockClear();

    fireEvent.click(screen.getByRole("tab", { name: /HyGO/ }));
    await waitFor(() => {
      expect(mockFetchTrace).toHaveBeenCalledWith(
        expect.objectContaining({ algo_key: "hygo" }),
      );
    });
    // both algorithms are registered in the outcome strip
    await waitFor(() => {
      const strip = screen.getByText("outcomes this session").closest("div");
      expect(
        within(strip!.parentElement!).getAllByText(/HyGO/).length,
      ).toBeGreaterThan(0);
    });
  });

  it("rejects invalid parameters without calling the backend", async () => {
    render(<SimulationView />);
    await waitFor(() => {
      expect(screen.getByText("outcomes this session")).toBeInTheDocument();
    });
    const calls = mockFetchTrace.mock.calls.length;
    const evalsInput = screen.getByLabelText("Max evals");
    fireEvent.change(evalsInput, { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", { name: /run/i }));
    expect(mockFetchTrace.mock.calls.length).toBe(calls);
  });

  it("maximizes into a two-panel view and minimizes back", async () => {
    render(<SimulationView />);
    await waitFor(() => {
      expect(screen.getByTestId("sim-scene-mock")).toBeInTheDocument();
    });
    expect(screen.queryByTitle("Minimize")).not.toBeInTheDocument();

    // maximize: dialog opens with scene and code side by side
    fireEvent.click(screen.getByTitle("Maximize"));
    await waitFor(() => {
      expect(screen.getAllByTestId("sim-scene-mock")).toHaveLength(2);
    });
    expect(screen.getAllByText("source of truth")).toHaveLength(2);

    // playback controls are available inside the maximized dialog and share
    // state with the main workspace (both scrubbers show the same step)
    expect(screen.getAllByText(/step 1\/6/)).toHaveLength(2);
    const playButtons = screen.getAllByRole("button", { name: "Play" });
    fireEvent.click(playButtons[playButtons.length - 1]!);
    await waitFor(() => {
      expect(screen.getAllByText(/step 2\/6/)).toHaveLength(2);
    });

    // minimize: back to the single workspace layout
    fireEvent.click(screen.getAllByTitle("Minimize")[0]);
    await waitFor(() => {
      expect(screen.getAllByTestId("sim-scene-mock")).toHaveLength(1);
    });
    expect(screen.queryByTitle("Minimize")).not.toBeInTheDocument();
  });

  it("shows an error state when the backend fails", async () => {
    mockFetchTrace.mockRejectedValue(new Error("boom"));
    render(<SimulationView />);
    await waitFor(() => {
      expect(screen.getByText(/Simulation failed/)).toBeInTheDocument();
    });
  });
});
