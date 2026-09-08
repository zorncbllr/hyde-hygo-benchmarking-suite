import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CodePanel from "@/components/simulation/CodePanel";
import { tokenizePython, type PyToken } from "@/lib/pyTokens";

const KINDS = (tokens: PyToken[]) =>
  tokens.map((t) => [t.text, t.kind] as const);

describe("tokenizePython", () => {
  it("tokenizes keywords, builtins, numbers, strings and comments", () => {
    const lines = tokenizePython(
      ["x = range(12)  # build", 's = "hi # not comment"', "return None"].join(
        "\n",
      ),
    );
    expect(lines[0].map((t) => t.kind)).toEqual([
      "plain",
      "plain",
      "call",
      "plain",
      "number",
      "plain",
      "comment",
    ]);
    expect(lines[0][2]).toEqual({ text: "range", kind: "call" });
    expect(lines[0][4]).toEqual({ text: "12", kind: "number" });
    expect(KINDS(lines[1])).toEqual([
      ["s", "plain"],
      [" = ", "plain"],
      ['"hi # not comment"', "string"],
    ]);
    expect(KINDS(lines[2])).toEqual([
      ["return", "keyword"],
      [" ", "plain"],
      ["None", "keyword"],
    ]);
  });

  it("colors calls amber but keeps keywords plain-headed", () => {
    const lines = tokenizePython("while foo(x):\n    if bar(y):\n        pass");
    // while/if are keywords even when followed by "("
    expect(lines[0].find((t) => t.text === "while")?.kind).toBe("keyword");
    expect(lines[0].find((t) => t.text === "foo")?.kind).toBe("call");
    expect(lines[1].find((t) => t.text === "if")?.kind).toBe("keyword");
    expect(lines[1].find((t) => t.text === "bar")?.kind).toBe("call");
  });

  it("colors self as a plain identifier (PyCharm style)", () => {
    const [line] = tokenizePython("self.x = len(y)");
    expect(line.find((t) => t.text === "self")?.kind).toBe("plain");
    expect(line.find((t) => t.text === "len")?.kind).toBe("call");
  });

  it("marks function vs class definition names distinctly", () => {
    const [defLine] = tokenizePython("def _encode(self, x):");
    expect(defLine.find((t) => t.kind === "def")?.text).toBe("_encode");
    const [classLine] = tokenizePython("class HyDEBin:");
    expect(classLine.find((t) => t.kind === "classDef")?.text).toBe("HyDEBin");
  });

  it("keeps multi-line strings as strings across lines", () => {
    const lines = tokenizePython('s = """start\nmiddle"""\nx = 1');
    expect(lines[0].map((t) => t.kind)).toEqual(["plain", "plain", "string"]);
    expect(lines[1][0].kind).toBe("string");
    expect(lines[2].map((t) => t.kind)).toEqual(["plain", "plain", "number"]);
  });

  it("handles floats with exponents", () => {
    const tokens = tokenizePython("y = 1.5e-3")[0];
    expect(tokens[2]).toEqual({ text: "1.5e-3", kind: "number" });
  });
});

describe("CodePanel", () => {
  const source =
    "class Algo:\n    def run(self):\n        x = 1\n        y = 2\n";

  it("renders line numbers and the source header", () => {
    render(<CodePanel source={source} currentLine={3} beat={null} />);
    expect(screen.getByText("source of truth")).toBeInTheDocument();
    expect(screen.getByText("line 3")).toBeInTheDocument();
    // gutter numbers 1..4 all rendered
    for (const n of ["1", "2", "3", "4"]) {
      expect(screen.getAllByText(n).length).toBeGreaterThan(0);
    }
  });

  it("highlights the current line and tints the beat region", () => {
    const { container } = render(
      <CodePanel
        source={source}
        currentLine={3}
        beat={{
          phase: "de",
          title: "t",
          body: "b",
          start_line: 2,
          end_line: 4,
        }}
      />,
    );
    const rows = container.querySelectorAll(".min-w-max > div");
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows[2].className).toContain("bg-primary/15");
    expect(rows[1].className).toContain("bg-white/[0.055]");
    expect(rows[0].className).not.toContain("bg-primary/15");
  });
});

describe("tokenizePython (regression: mid-line @)", () => {
  it("terminates on mid-line @ (numpy matmul) instead of looping forever", () => {
    // regression: the plain-run scanner used to exclude `@`, so a mid-line
    // matmul operator sent the tokenizer into an infinite loop and wedged
    // the webview at 100% CPU
    const lines = tokenizePython(
      "X = np.clip(mean + sig * (Z * D) @ B.T, lo, hi)",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].map((t) => t.kind)).toContain("plain");
  });

  it("still tokenizes line-initial decorators", () => {
    const [line] = tokenizePython("@staticmethod");
    expect(line[0]).toEqual({ text: "@staticmethod", kind: "decorator" });
  });
});
