import type { RunRecord } from "./types";

// ── Color types ──

export interface AnsiAttrs {
  fg?: string;    // hex color
  bg?: string;    // hex color
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface TerminalSpan {
  text: string;
  attrs: AnsiAttrs;
}

export type TerminalColoredLine = TerminalSpan[];

// One Dark palette for 8+8 ANSI colors
const ANSI_COLORS: string[] = [
  // Normal (30-37)
  "#282c34", // 0 black
  "#e06c75", // 1 red
  "#98c379", // 2 green
  "#e5c07b", // 3 yellow
  "#61afef", // 4 blue
  "#c678dd", // 5 magenta
  "#56b6c2", // 6 cyan
  "#abb2bf", // 7 white
  // Bright (90-97)
  "#5c6370", // 8 bright black
  "#e06c75", // 9 bright red
  "#98c379", // 10 bright green
  "#e5c07b", // 11 bright yellow
  "#61afef", // 12 bright blue
  "#c678dd", // 13 bright magenta
  "#56b6c2", // 14 bright cyan
  "#ffffff", // 15 bright white
];

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

function map256Color(n: number): string | undefined {
  if (n < 0 || n > 255) return undefined;
  if (n < 16) return ANSI_COLORS[n];
  if (n < 232) {
    // 6x6x6 color cube
    const idx = n - 16;
    const b = (idx % 6) * 51;
    const g = (Math.floor(idx / 6) % 6) * 51;
    const r = Math.floor(idx / 36) * 51;
    return rgbToHex(r, g, b);
  }
  // Grayscale ramp 232-255
  const v = (n - 232) * 10 + 8;
  return rgbToHex(v, v, v);
}

// ── Terminal state ──

interface TerminalState {
  lines: string[];
  attrs: AnsiAttrs[][];
  currentAttrs: AnsiAttrs;
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
  while (state.attrs.length <= row) {
    state.attrs.push([]);
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

  // Write attrs — pad with empty attrs if cursor is beyond current attrs length
  ensureRow(state, state.row);
  const rowAttrs = state.attrs[state.row]!;
  while (rowAttrs.length < state.col) {
    rowAttrs.push({});
  }
  rowAttrs[state.col] = { ...state.currentAttrs };
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
    case "m": {
      // SGR — Select Graphic Rendition
      const codes = params.length > 0 ? params.split(";").map((v) => parseInt(v, 10) || 0) : [0];
      for (let ci = 0; ci < codes.length; ci++) {
        const code = codes[ci]!;
        if (code === 0) {
          state.currentAttrs = {};
        } else if (code === 1) {
          state.currentAttrs = { ...state.currentAttrs, bold: true };
        } else if (code === 2) {
          state.currentAttrs = { ...state.currentAttrs, dim: true };
        } else if (code === 3) {
          state.currentAttrs = { ...state.currentAttrs, italic: true };
        } else if (code === 4) {
          state.currentAttrs = { ...state.currentAttrs, underline: true };
        } else if (code === 22) {
          state.currentAttrs = { ...state.currentAttrs, bold: undefined, dim: undefined };
        } else if (code === 23) {
          state.currentAttrs = { ...state.currentAttrs, italic: undefined };
        } else if (code === 24) {
          state.currentAttrs = { ...state.currentAttrs, underline: undefined };
        } else if (code >= 30 && code <= 37) {
          state.currentAttrs = { ...state.currentAttrs, fg: ANSI_COLORS[code - 30] };
        } else if (code >= 40 && code <= 47) {
          state.currentAttrs = { ...state.currentAttrs, bg: ANSI_COLORS[code - 40] };
        } else if (code >= 90 && code <= 97) {
          state.currentAttrs = { ...state.currentAttrs, fg: ANSI_COLORS[code - 90 + 8] };
        } else if (code >= 100 && code <= 107) {
          state.currentAttrs = { ...state.currentAttrs, bg: ANSI_COLORS[code - 100 + 8] };
        } else if (code === 39) {
          state.currentAttrs = { ...state.currentAttrs, fg: undefined };
        } else if (code === 49) {
          state.currentAttrs = { ...state.currentAttrs, bg: undefined };
        } else if ((code === 38 || code === 48) && ci + 1 < codes.length) {
          const mode = codes[ci + 1]!;
          const isFg = code === 38;
          if (mode === 5 && ci + 2 < codes.length) {
            // 256-color: 38;5;N or 48;5;N
            const color = map256Color(codes[ci + 2]!);
            if (color) {
              state.currentAttrs = isFg
                ? { ...state.currentAttrs, fg: color }
                : { ...state.currentAttrs, bg: color };
            }
            ci += 2;
          } else if (mode === 2 && ci + 4 < codes.length) {
            // RGB: 38;2;R;G;B or 48;2;R;G;B
            const color = rgbToHex(codes[ci + 2]!, codes[ci + 3]!, codes[ci + 4]!);
            state.currentAttrs = isFg
              ? { ...state.currentAttrs, fg: color }
              : { ...state.currentAttrs, bg: color };
            ci += 4;
          }
        }
      }
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

function parseTerminalStream(stream: string): { lines: string[]; attrs: AnsiAttrs[][] } {
  const state: TerminalState = {
    lines: [""],
    attrs: [[]],
    currentAttrs: {},
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
        state.attrs = [[]];
        state.currentAttrs = {};
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

  return { lines: state.lines, attrs: state.attrs };
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
  const parsed = parseTerminalStream(rawStream);
  const renderedLines = parsed.lines
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

// ── Colored readable display ──

function attrsEqual(a: AnsiAttrs, b: AnsiAttrs): boolean {
  return a.fg === b.fg && a.bg === b.bg && a.bold === b.bold &&
    a.dim === b.dim && a.italic === b.italic && a.underline === b.underline;
}

function lineToSpans(text: string, rowAttrs: AnsiAttrs[]): TerminalColoredLine {
  if (text.length === 0) return [];
  const spans: TerminalSpan[] = [];
  let currentAttrs: AnsiAttrs = rowAttrs[0] ?? {};
  let currentText = "";

  for (let i = 0; i < text.length; i++) {
    const charAttrs = rowAttrs[i] ?? {};
    if (currentText.length > 0 && !attrsEqual(currentAttrs, charAttrs)) {
      spans.push({ text: currentText, attrs: currentAttrs });
      currentText = "";
      currentAttrs = charAttrs;
    }
    currentText += text[i];
  }
  if (currentText.length > 0) {
    spans.push({ text: currentText, attrs: currentAttrs });
  }
  return spans;
}

export interface ColoredTerminalDisplay {
  lines: TerminalColoredLine[];
  text: string;
  visibleLineCount: number;
  hiddenLineCount: number;
  updatedAt?: string;
}

export function buildColoredReadableDisplay(
  run: RunRecord | undefined,
  options?: { maxLines?: number },
): ColoredTerminalDisplay {
  if (!run) {
    return { lines: [], text: "", visibleLineCount: 0, hiddenLineCount: 0 };
  }

  const rawTerminalChunks = run.rawLogs
    .filter((line) => line.stream === "stdout" || line.stream === "stderr")
    .map((line) => line.text);
  const rawStream = rawTerminalChunks.join("");
  const parsed = parseTerminalStream(rawStream);

  // Clean lines (same as buildReadableText but preserve index mapping to attrs)
  const cleanRegexes = [
    /\u001B\[\?2004[hl]/g,
    /\u001B\[\?\d+[hl]/g,
    ANSI_ESCAPE_RE,
    ANSI_C1_CSI_RE,
    /\\x1b\[[0-9;?]*[A-Za-z]/gi,
    /\u009b[0-?]*[ -/]*[@-~]/g,
    /[\u0000-\u0008\u000B-\u001A\u001C-\u001F\u007F]/g,
  ] as const;

  const cleanedLines: string[] = [];
  const cleanedAttrs: AnsiAttrs[][] = [];

  for (let row = 0; row < parsed.lines.length; row++) {
    let line = parsed.lines[row] ?? "";
    const rowAttrs = parsed.attrs[row] ?? [];

    // Check if line has any ANSI residue (from incomplete parses)
    let hasResidualAnsi = false;
    for (const re of cleanRegexes) {
      if (re.test(line)) { hasResidualAnsi = true; break; }
      re.lastIndex = 0; // reset regex state
    }

    if (hasResidualAnsi) {
      // Fallback: strip ANSI and lose attrs for this line
      for (const re of cleanRegexes) {
        line = line.replace(re, "");
        re.lastIndex = 0;
      }
      line = line.replace(/\t/g, "    ").replace(/[^\S ]{2,}/g, " ").replace(/\s+$/g, "");
      cleanedLines.push(line);
      cleanedAttrs.push([]);
    } else {
      line = line.replace(/\t/g, "    ").replace(/[^\S ]{2,}/g, " ").replace(/\s+$/g, "");
      cleanedLines.push(line);
      cleanedAttrs.push(rowAttrs);
    }
  }

  // Collapse transient progress lines (with index tracking for attrs)
  const output: { text: string; attrs: AnsiAttrs[] }[] = [];
  const byKey = new Map<string, number>();

  for (let i = 0; i < cleanedLines.length; i++) {
    const line = cleanedLines[i]!;
    const rowAttrs = cleanedAttrs[i] ?? [];

    if (line.trim().length === 0) {
      if (output.length > 0 && output[output.length - 1]!.text !== "") {
        output.push({ text: "", attrs: [] });
      }
      continue;
    }

    const key = transientProgressKey(line);
    if (!key) {
      if (output.length > 0 && output[output.length - 1]!.text === line) continue;
      output.push({ text: line, attrs: rowAttrs });
      continue;
    }

    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, output.length);
      output.push({ text: line, attrs: rowAttrs });
      continue;
    }
    output[existing] = { text: line, attrs: rowAttrs };
  }

  // Trim trailing empty lines
  while (output.length > 1 && output[output.length - 1]!.text.length === 0) {
    output.pop();
  }

  const maxLines = options?.maxLines ?? 500;
  const visible = output.slice(-maxLines);

  const coloredLines: TerminalColoredLine[] = visible.map(
    (entry) => lineToSpans(entry.text, entry.attrs),
  );
  const plainText = visible.map((entry) => entry.text).join("\n").trimEnd();
  const latestRaw = run.rawLogs.length > 0 ? run.rawLogs[run.rawLogs.length - 1] : undefined;

  return {
    lines: coloredLines,
    text: plainText,
    visibleLineCount: coloredLines.length,
    hiddenLineCount: Math.max(0, output.length - maxLines),
    updatedAt: latestRaw?.timestamp ?? run.startedAt,
  };
}
