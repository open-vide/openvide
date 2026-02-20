import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { daemonDir } from "./utils.js";
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
  fs.appendFileSync(p, line, "utf-8");
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
 * Tail output.jsonl with follow mode.
 * Calls `onLine` for each new line. Resolves when the session reaches a terminal state
 * (checked via `isTerminal` callback) or when the AbortSignal fires.
 */
export async function tailOutput(
  sessionId: string,
  offset: number,
  onLine: (line: string) => void,
  isTerminal: () => boolean,
  signal: AbortSignal,
): Promise<void> {
  const p = outputPath(sessionId);

  // First, emit any existing lines from offset
  if (fs.existsSync(p)) {
    const existing = readOutputLines(sessionId, offset);
    for (const line of existing) {
      onLine(line);
    }
    offset += existing.length;
  }

  if (isTerminal()) return;
  if (signal.aborted) return;

  // Watch for new lines
  return new Promise<void>((resolve) => {
    let currentOffset = offset;
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

    const checkNewLines = () => {
      try {
        const newLines = readOutputLines(sessionId, currentOffset);
        for (const line of newLines) {
          onLine(line);
        }
        currentOffset += newLines.length;
      } catch {
        // File might be temporarily unavailable during writes
      }

      if (isTerminal()) {
        // Do one final read to catch any remaining lines
        try {
          const finalLines = readOutputLines(sessionId, currentOffset);
          for (const line of finalLines) {
            onLine(line);
          }
        } catch {
          // ignore
        }
        cleanup();
        resolve();
      }
    };

    signal.addEventListener("abort", () => {
      cleanup();
      resolve();
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
