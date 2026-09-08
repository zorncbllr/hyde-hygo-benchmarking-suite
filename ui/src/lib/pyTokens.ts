/**
 * Minimal Python tokenizer: stateful across lines (multi-line strings) but
 * otherwise intentionally simple -- enough for readable, dependency-free
 * highlighting of the vendored algorithm sources.
 */

export type TokenKind =
  | "plain"
  | "comment"
  | "string"
  | "keyword"
  | "builtin"
  | "number"
  | "decorator"
  | "def"
  | "classDef"
  | "call";

export interface PyToken {
  text: string;
  kind: TokenKind;
}

const KEYWORDS = new Set([
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield",
  "True",
  "False",
  "None",
]);

const BUILTINS = new Set([
  "abs",
  "all",
  "any",
  "bool",
  "dict",
  "enumerate",
  "float",
  "format",
  "int",
  "isinstance",
  "len",
  "list",
  "max",
  "min",
  "print",
  "range",
  "reversed",
  "set",
  "sorted",
  "str",
  "sum",
  "super",
  "tuple",
  "type",
  "zip",
]);

interface ScanResult {
  tokens: PyToken[];
  triple: string | null;
}

function indexOfSingle(line: string, from: number, quote: string): number {
  for (let j = from; j < line.length; j++) {
    if (line[j] === "\\") j++;
    else if (line[j] === quote) return j;
  }
  return -1;
}

function scanLine(line: string, triple: string | null): ScanResult {
  const tokens: PyToken[] = [];
  let i = 0;
  // last non-whitespace word, used to detect def/class names
  let prevWord: string | null = null;

  const push = (text: string, kind: TokenKind) => {
    if (text) tokens.push({ text, kind });
  };

  if (triple) {
    const end = line.indexOf(triple);
    if (end === -1) {
      push(line, "string");
      return { tokens, triple };
    }
    push(line.slice(0, end + triple.length), "string");
    i = end + triple.length;
  }

  while (i < line.length) {
    const ch = line[i];
    if (ch === "#") {
      push(line.slice(i), "comment");
      break;
    }
    if (ch === '"' || ch === "'") {
      const isTriple = line.startsWith(ch.repeat(3), i);
      const quote = isTriple ? ch.repeat(3) : ch;
      const end = isTriple
        ? line.indexOf(quote, i + 3)
        : indexOfSingle(line, i + 1, ch);
      if (end === -1) {
        // unterminated: triple opens a multi-line string, single stays inline
        push(line.slice(i), "string");
        return { tokens, triple: isTriple ? quote : triple };
      }
      push(line.slice(i, end + quote.length), "string");
      i = end + quote.length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < line.length && /[A-Za-z0-9_]/.test(line[j])) j++;
      const word = line.slice(i, j);
      if (prevWord === "def") {
        push(word, "def");
      } else if (prevWord === "class") {
        push(word, "classDef");
      } else if (KEYWORDS.has(word)) {
        push(word, "keyword");
      } else if (line[j] === "(") {
        // PyCharm Darcula style: function/method calls in amber
        push(word, "call");
      } else if (BUILTINS.has(word)) {
        push(word, "builtin");
      } else {
        push(word, "plain");
      }
      prevWord = word;
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < line.length && /[0-9_.eE+-]/.test(line[j])) {
        // stop +/- unless part of an exponent
        if ((line[j] === "+" || line[j] === "-") && !/[eE]/.test(line[j - 1])) {
          break;
        }
        j++;
      }
      push(line.slice(i, j), "number");
      i = j;
      continue;
    }
    if (ch === "@" && line.slice(0, i).trim() === "") {
      let j = i + 1;
      while (j < line.length && /[A-Za-z0-9_.]/.test(line[j])) j++;
      push(line.slice(i, j), "decorator");
      i = j;
      continue;
    }
    let j = i;
    // NOTE: `@` must NOT be excluded here: the decorator branch only
    // consumes line-initial `@`; mid-line `@` (numpy matmul, e.g.
    // `(Z * D) @ B.T`) must be consumed as plain text or the scanner
    // never advances (infinite loop).
    while (j < line.length && !/[A-Za-z0-9_"'#]/.test(line[j])) {
      j++;
    }
    push(line.slice(i, j), "plain");
    i = j;
  }
  return { tokens, triple: null };
}

export function tokenizePython(source: string): PyToken[][] {
  const lines = source.split("\n");
  const out: PyToken[][] = [];
  let triple: string | null = null;
  for (const line of lines) {
    const res = scanLine(line, triple);
    out.push(res.tokens);
    triple = res.triple;
  }
  return out;
}
