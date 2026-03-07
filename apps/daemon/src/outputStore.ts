import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { daemonDir, logError } from "./utils.js";
import type { OutputLine } from "./types.js";

function sessionDir(sessionId: string): string {
  return path.join(daemonDir(), "sessions", sessionId);
}

function outputPath(sessionId: string): string {
  return path.join(sessionDir(sessionId), "output.jsonl");
}

export function ensureSessionDir(sessionId: string): void {
  const dir = sessionDir(sessionId);
  fs.mkdirSync(dir, { recursive: true });
}

export function appendOutput(sessionId: string, entry: OutputLine): { lines: number; bytes: number } {
  const line = JSON.stringify(entry) + "\n";
  const p = outputPath(sessionId);
  try {
    fs.appendFileSync(p, line, "utf-8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      // Session output dir may be removed during teardown; drop late writes safely.
      logError(`Skipping output append for removed session ${sessionId}`);
      return { lines: 0, bytes: 0 };
    }
    throw err;
  }
  return { lines: 1, bytes: Buffer.byteLength(line, "utf-8") };
}

export function removeSessionDir(sessionId: string): void {
  const dir = sessionDir(sessionId);
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Read output.jsonl starting from a line offset.
 * Returns lines as raw JSON strings (one per line).
 */
export function readOutputLines(sessionId: string, offset: number): string[] {
  const p = outputPath(sessionId);
  if (!fs.existsSync(p)) return [];

  const content = fs.readFileSync(p, "utf-8");
  const allLines = content.split("\n").filter((l) => l.length > 0);
  return allLines.slice(offset);
}

/**
 * Read new lines from output.jsonl starting at a byte offset.
 * Returns the lines and the new byte position. Much cheaper than
 * re-parsing the entire file on every poll tick.
 */
function readOutputLinesFromByte(
  sessionId: string,
  byteOffset: number,
): { lines: string[]; newByteOffset: number } {
  const p = outputPath(sessionId);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(p);
  } catch {
    return { lines: [], newByteOffset: byteOffset };
  }
  if (stat.size <= byteOffset) {
    return { lines: [], newByteOffset: byteOffset };
  }

  const fd = fs.openSync(p, "r");
  try {
    const len = stat.size - byteOffset;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, byteOffset);
    const chunk = buf.toString("utf-8");
    const raw = chunk.split("\n").filter((l) => l.length > 0);

    // If the chunk doesn't end with a newline, the last segment is incomplete —
    // hold it back until the next read.
    if (!chunk.endsWith("\n") && raw.length > 0) {
      const incomplete = raw.pop()!;
      const consumed = len - Buffer.byteLength(incomplete, "utf-8");
      return { lines: raw, newByteOffset: byteOffset + consumed };
    }
    return { lines: raw, newByteOffset: stat.size };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Check whether a raw JSONL line is a turn_end meta event.
 */
function isTurnEndLine(line: string): boolean {
  try {
    const obj = JSON.parse(line);
    return obj.t === "m" && obj.event === "turn_end";
  } catch {
    return false;
  }
}

/**
 * Tail output.jsonl with follow mode.
 * Calls `onLine` for each new line. Resolves when the session reaches a terminal state
 * (checked via `isTerminal` callback), when a `turn_end` meta line is emitted,
 * or when the AbortSignal fires.
 */
export async function tailOutput(
  sessionId: string,
  offset: number,
  onLine: (line: string) => void,
  isTerminal: () => boolean,
  signal: AbortSignal,
): Promise<void> {
  const p = outputPath(sessionId);

  // Compute initial byte offset by reading the first `offset` lines.
  let bytePos = 0;
  if (offset > 0 && fs.existsSync(p)) {
    const content = fs.readFileSync(p, "utf-8");
    const allLines = content.split("\n").filter((l) => l.length > 0);
    const skipped = allLines.slice(0, offset);
    // Each line was stored as JSON + "\n", so byte length = sum of encoded lines + newlines.
    for (const l of skipped) {
      bytePos += Buffer.byteLength(l, "utf-8") + 1; // +1 for the newline
    }
  }

  // Emit any existing lines from offset
  let sawTurnEnd = false;
  if (fs.existsSync(p)) {
    const { lines: existing, newByteOffset } = readOutputLinesFromByte(sessionId, bytePos);
    bytePos = newByteOffset;
    for (const line of existing) {
      onLine(line);
      if (isTurnEndLine(line)) sawTurnEnd = true;
    }
  }

  if (sawTurnEnd || isTerminal()) return;
  if (signal.aborted) return;

  // Watch for new lines
  return new Promise<void>((resolve) => {
    let resolved = false;
    let checking = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let watcher: fs.FSWatcher | undefined;

    const cleanup = () => {
      if (watcher) {
        watcher.close();
        watcher = undefined;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
    };

    const finish = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve();
    };

    const checkNewLines = () => {
      if (checking || resolved) return;
      checking = true;
      try {
        const { lines: newLines, newByteOffset } = readOutputLinesFromByte(sessionId, bytePos);
        bytePos = newByteOffset;
        for (const line of newLines) {
          onLine(line);
          if (isTurnEndLine(line)) {
            finish();
            return;
          }
        }
      } catch {
        // File might be temporarily unavailable during writes
      } finally {
        checking = false;
      }

      if (isTerminal()) {
        // Do one final read to catch any remaining lines
        checking = true;
        try {
          const { lines: finalLines } = readOutputLinesFromByte(sessionId, bytePos);
          for (const line of finalLines) {
            onLine(line);
          }
        } catch {
          // ignore
        } finally {
          checking = false;
        }
        finish();
      }
    };

    signal.addEventListener("abort", () => {
      finish();
    }, { once: true });

    // Use fs.watch + polling fallback
    try {
      watcher = fs.watch(p, () => checkNewLines());
    } catch {
      // fs.watch not available, rely on polling only
    }

    // Poll every 250ms as fallback / supplement to fs.watch
    pollTimer = setInterval(checkNewLines, 250);
  });
}
