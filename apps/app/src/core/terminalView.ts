import type { RunRecord } from "./types";

interface TerminalState {
  lines: string[];
  row: number;
  col: number;
  savedRow: number;
  savedCol: number;
}

const ANSI_ESCAPE_RE = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g;
const ANSI_C1_CSI_RE = /\u009B[0-?]*[ -/]*[@-~]/g;
const CONTROL_KEEP_NL_TAB_RE = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

function ensureRow(state: TerminalState, row: number): void {
  while (state.lines.length <= row) {
    state.lines.push("");
  }
}

function setLine(state: TerminalState, row: number, value: string): void {
  ensureRow(state, row);
  state.lines[row] = value;
}

function getLine(state: TerminalState, row: number): string {
  ensureRow(state, row);
  return state.lines[row] ?? "";
}

function moveCursor(state: TerminalState, row: number, col: number): void {
  state.row = Math.max(0, row);
  state.col = Math.max(0, col);
  ensureRow(state, state.row);
}

function writeChar(state: TerminalState, char: string): void {
  const line = getLine(state, state.row);
  const prefix = state.col > line.length ? `${line}${" ".repeat(state.col - line.length)}` : line;
  const updated =
    state.col >= prefix.length
      ? `${prefix}${char}`
      : `${prefix.slice(0, state.col)}${char}${prefix.slice(state.col + 1)}`;
  setLine(state, state.row, updated);
  state.col += 1;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value || value.length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function applyCsi(state: TerminalState, paramsRaw: string, command: string): void {
  let params = paramsRaw;
  if (params.startsWith("?") || params.startsWith(">")) {
    params = params.slice(1);
  }
  const values = params.length > 0 ? params.split(";") : [];
  const valueAt = (index: number, fallback: number): number => parseNumber(values[index], fallback);

  switch (command) {
    case "A":
      moveCursor(state, state.row - valueAt(0, 1), state.col);
      return;
    case "B":
      moveCursor(state, state.row + valueAt(0, 1), state.col);
      return;
    case "C":
      moveCursor(state, state.row, state.col + valueAt(0, 1));
      return;
    case "D":
      moveCursor(state, state.row, state.col - valueAt(0, 1));
      return;
    case "E":
      moveCursor(state, state.row + valueAt(0, 1), 0);
      return;
    case "F":
      moveCursor(state, state.row - valueAt(0, 1), 0);
      return;
    case "G":
      moveCursor(state, state.row, valueAt(0, 1) - 1);
      return;
    case "H":
    case "f":
      moveCursor(state, valueAt(0, 1) - 1, valueAt(1, 1) - 1);
      return;
    case "J": {
      const mode = valueAt(0, 0);
      if (mode === 2) {
        state.lines = [""];
        moveCursor(state, 0, 0);
        return;
      }
      if (mode === 0) {
        const line = getLine(state, state.row);
        setLine(state, state.row, line.slice(0, state.col));
        for (let row = state.row + 1; row < state.lines.length; row += 1) {
          state.lines[row] = "";
        }
        return;
      }
      if (mode === 1) {
        const line = getLine(state, state.row);
        setLine(state, state.row, `${" ".repeat(state.col)}${line.slice(state.col)}`);
        for (let row = 0; row < state.row; row += 1) {
          state.lines[row] = "";
        }
      }
      return;
    }
    case "K": {
      const mode = valueAt(0, 0);
      const line = getLine(state, state.row);
      if (mode === 2) {
        setLine(state, state.row, "");
        return;
      }
      if (mode === 1) {
        setLine(state, state.row, `${" ".repeat(state.col)}${line.slice(state.col)}`);
        return;
      }
      setLine(state, state.row, line.slice(0, state.col));
      return;
    }
    case "P": {
      const count = valueAt(0, 1);
      const line = getLine(state, state.row);
      const before = line.slice(0, state.col);
      const after = line.slice(state.col + count);
      setLine(state, state.row, `${before}${after}`);
      return;
    }
    case "X": {
      const count = valueAt(0, 1);
      const line = getLine(state, state.row);
      const before = line.slice(0, state.col);
      const after = line.slice(state.col + count);
      setLine(state, state.row, `${before}${" ".repeat(count)}${after}`);
      return;
    }
    case "@": {
      const count = valueAt(0, 1);
      const line = getLine(state, state.row);
      const before = line.slice(0, state.col);
      const after = line.slice(state.col);
      setLine(state, state.row, `${before}${" ".repeat(count)}${after}`);
      return;
    }
    case "L": {
      const count = valueAt(0, 1);
      ensureRow(state, state.row);
      for (let i = 0; i < count; i += 1) {
        state.lines.splice(state.row, 0, "");
      }
      return;
    }
    case "M": {
      const count = valueAt(0, 1);
      ensureRow(state, state.row);
      for (let i = 0; i < count; i += 1) {
        if (state.row < state.lines.length) {
          state.lines.splice(state.row, 1);
        }
      }
      ensureRow(state, state.row);
      return;
    }
    case "s":
      state.savedRow = state.row;
      state.savedCol = state.col;
      return;
    case "u":
      moveCursor(state, state.savedRow, state.savedCol);
      return;
    default:
      return;
  }
}

function parseTerminalStream(stream: string): string[] {
  const state: TerminalState = {
    lines: [""],
    row: 0,
    col: 0,
    savedRow: 0,
    savedCol: 0,
  };

  for (let i = 0; i < stream.length; i += 1) {
    const char = stream[i] ?? "";

    if (char === "\u001b" || char === "\u009b") {
      const csiStart = char === "\u009b" ? i + 1 : i + 2;
      const hasBracket = char === "\u009b" || stream[i + 1] === "[";
      if (hasBracket) {
        let j = csiStart;
        while (j < stream.length && !/[@-~]/.test(stream[j] ?? "")) {
          j += 1;
        }
        if (j < stream.length) {
          const params = stream.slice(csiStart, j);
          const command = stream[j] ?? "";
          applyCsi(state, params, command);
          i = j;
          continue;
        }
      }

      if (char === "\u001b" && stream[i + 1] === "]") {
        let j = i + 2;
        while (j < stream.length) {
          const oscChar = stream[j] ?? "";
          if (oscChar === "\u0007") {
            break;
          }
          if (oscChar === "\u001b" && stream[j + 1] === "\\") {
            j += 1;
            break;
          }
          j += 1;
        }
        i = j;
        continue;
      }

      if (char === "\u001b" && stream[i + 1] === "7") {
        state.savedRow = state.row;
        state.savedCol = state.col;
        i += 1;
        continue;
      }
      if (char === "\u001b" && stream[i + 1] === "8") {
        moveCursor(state, state.savedRow, state.savedCol);
        i += 1;
        continue;
      }
      if (char === "\u001b" && stream[i + 1] === "c") {
        state.lines = [""];
        moveCursor(state, 0, 0);
        i += 1;
        continue;
      }

      continue;
    }

    if (char === "\n") {
      moveCursor(state, state.row + 1, 0);
      continue;
    }
    if (char === "\r") {
      moveCursor(state, state.row, 0);
      continue;
    }
    if (char === "\b") {
      moveCursor(state, state.row, state.col - 1);
      continue;
    }
    if (char === "\t") {
      const spaces = 4 - (state.col % 4);
      for (let s = 0; s < spaces; s += 1) {
        writeChar(state, " ");
      }
      continue;
    }
    if (char < " " || char === "\u007f") {
      continue;
    }

    writeChar(state, char);
  }

  return state.lines;
}

export interface TerminalDisplay {
  text: string;
  visibleLineCount: number;
  hiddenLineCount: number;
  updatedAt?: string;
}

function buildPlainTextFallback(rawStream: string): string {
  return rawStream
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(ANSI_ESCAPE_RE, "")
    .replace(ANSI_C1_CSI_RE, "")
    .replace(/\\x1b\[[0-9;?]*[A-Za-z]/gi, "")
    .replace(/\[(?:\?[\d;]*|[\d;]{1,12})[A-Za-z]/g, "")
    .replace(/\u001B/g, "")
    .replace(CONTROL_KEEP_NL_TAB_RE, "")
    .replace(/\t/g, "    ")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

function transientProgressKey(line: string): string | undefined {
  const normalized = line
    .toLowerCase()
    .replace(/[\u2800-\u28ff]/g, " ")
    .replace(/\(thought for \d+s\)/g, "(thought)")
    .replace(/\b\d+(?:\.\d+)?s\b/g, "{seconds}")
    .replace(/\b\d+%\b/g, "{percent}")
    .replace(/[^a-z0-9{} ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length === 0) {
    return undefined;
  }

  if (
    normalized.includes("thought for") ||
    normalized.includes("thinking") ||
    normalized.includes("meandering") ||
    normalized.includes("loading") ||
    normalized.includes("processing") ||
    normalized.includes("analyzing")
  ) {
    return normalized;
  }

  if (/^[\-|/\\]+$/.test(normalized)) {
    return "spinner";
  }

  return undefined;
}

function collapseTransientProgressLines(lines: string[]): string[] {
  const output: string[] = [];
  const byKey = new Map<string, number>();

  for (const line of lines) {
    if (line.trim().length === 0) {
      if (output[output.length - 1] !== "") {
        output.push("");
      }
      continue;
    }

    const key = transientProgressKey(line);
    if (!key) {
      if (output[output.length - 1] === line) {
        continue;
      }
      output.push(line);
      continue;
    }

    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, output.length);
      output.push(line);
      continue;
    }

    output[existing] = line;
  }

  return output;
}

function buildReadableText(renderedLines: string[]): string {
  const cleanedLines = renderedLines.map((line) =>
    line
      .replace(/\u001B\[\?2004[hl]/g, "")
      .replace(/\u001B\[\?\d+[hl]/g, "")
      .replace(ANSI_ESCAPE_RE, "")
      .replace(ANSI_C1_CSI_RE, "")
      .replace(/\\x1b\[[0-9;?]*[A-Za-z]/gi, "")
      .replace(/\u009b[0-?]*[ -/]*[@-~]/g, "")
      .replace(/[\u0000-\u0008\u000B-\u001A\u001C-\u001F\u007F]/g, "")
      .replace(/\t/g, "    ")
      .replace(/[^\S ]{2,}/g, " ")
      .replace(/\s+$/g, ""),
  );

  return collapseTransientProgressLines(cleanedLines)
    .join("\n")
    .replace(/[^\S\n]{2,}/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trimEnd();
}

export function buildTerminalDisplay(
  run: RunRecord | undefined,
  options?: { maxLines?: number; mode?: "readable" | "screen" },
): TerminalDisplay {
  if (!run) {
    return {
      text: "",
      visibleLineCount: 0,
      hiddenLineCount: 0,
    };
  }

  const rawTerminalChunks = run.rawLogs
    .filter((line) => line.stream === "stdout" || line.stream === "stderr")
    .map((line) => line.text);
  const rawStream = rawTerminalChunks.join("");
  const renderedLines = parseTerminalStream(rawStream)
    .map((line) => line.replace(/\s+$/g, ""))
    .slice();

  while (renderedLines.length > 1 && renderedLines[renderedLines.length - 1]?.length === 0) {
    renderedLines.pop();
  }

  const maxLines = options?.maxLines ?? 360;
  const renderedText = renderedLines.join("\n").trimEnd();
  const plainText = buildPlainTextFallback(rawStream);
  const readableText = buildReadableText(renderedLines);
  const usePlainFallback =
    renderedText.length === 0 ||
    (plainText.length > 0 && renderedText.length < Math.max(plainText.length * 0.3, 30));

  const outputText =
    options?.mode === "readable"
      ? readableText
      : usePlainFallback
        ? plainText
        : renderedText;
  const visibleLines = outputText.split("\n").slice(-maxLines);
  const latestRaw = run.rawLogs.length > 0 ? run.rawLogs[run.rawLogs.length - 1] : undefined;

  return {
    text: visibleLines.join("\n"),
    visibleLineCount: visibleLines.length,
    hiddenLineCount: 0,
    updatedAt: latestRaw?.timestamp ?? run.startedAt,
  };
}
