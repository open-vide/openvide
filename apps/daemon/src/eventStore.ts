import * as fs from "node:fs";
import * as path from "node:path";
import { daemonDir, logError } from "./utils.js";
import type { SessionEventRecord } from "./types.js";

function sessionDir(sessionId: string): string {
  return path.join(daemonDir(), "sessions", sessionId);
}

function eventsPath(sessionId: string): string {
  return path.join(sessionDir(sessionId), "events.jsonl");
}

export function appendSessionEvent(sessionId: string, event: SessionEventRecord): { lines: number; bytes: number } {
  const line = JSON.stringify(event) + "\n";
  const p = eventsPath(sessionId);
  try {
    fs.appendFileSync(p, line, "utf-8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      logError(`Skipping event append for removed session ${sessionId}`);
      return { lines: 0, bytes: 0 };
    }
    throw err;
  }
  return { lines: 1, bytes: Buffer.byteLength(line, "utf-8") };
}

function parseEventSeq(rawLine: string): number | undefined {
  try {
    const parsed = JSON.parse(rawLine) as { seq?: unknown };
    return typeof parsed.seq === "number" && Number.isFinite(parsed.seq) ? parsed.seq : undefined;
  } catch {
    return undefined;
  }
}

export function readSessionEventLines(sessionId: string, fromSeq = 1): string[] {
  const p = eventsPath(sessionId);
  if (!fs.existsSync(p)) return [];

  const content = fs.readFileSync(p, "utf-8");
  const lines = content.split("\n").filter((line) => line.length > 0);
  const wantedSeq = Math.max(1, Math.floor(fromSeq));
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const seq = parseEventSeq(line) ?? (i + 1);
    if (seq >= wantedSeq) {
      out.push(line);
    }
  }
  return out;
}

export function readSessionEvents(sessionId: string, fromSeq = 1): SessionEventRecord[] {
  const lines = readSessionEventLines(sessionId, fromSeq);
  const out: SessionEventRecord[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as SessionEventRecord);
    } catch {
      // ignore malformed line
    }
  }
  return out;
}

export async function tailSessionEvents(
  sessionId: string,
  fromSeq: number,
  onLine: (line: string) => void,
  isTerminal: () => boolean,
  signal: AbortSignal,
): Promise<void> {
  const p = eventsPath(sessionId);
  const wantedSeq = Math.max(1, Math.floor(fromSeq));
  let emittedMaxSeq = wantedSeq - 1;

  const emitLines = (lines: string[]): void => {
    for (const line of lines) {
      const seq = parseEventSeq(line);
      if (seq != null && seq <= emittedMaxSeq) continue;
      if (seq != null) {
        emittedMaxSeq = Math.max(emittedMaxSeq, seq);
      } else {
        emittedMaxSeq += 1;
      }
      onLine(line);
    }
  };

  if (fs.existsSync(p)) {
    emitLines(readSessionEventLines(sessionId, wantedSeq));
  }

  if (isTerminal()) return;
  if (signal.aborted) return;

  return new Promise<void>((resolve) => {
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
        const lines = readSessionEventLines(sessionId, emittedMaxSeq + 1);
        emitLines(lines);
      } catch {
        // ignore transient read failures
      }

      if (isTerminal()) {
        try {
          const finalLines = readSessionEventLines(sessionId, emittedMaxSeq + 1);
          emitLines(finalLines);
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

    try {
      watcher = fs.watch(p, () => checkNewLines());
    } catch {
      // polling fallback
    }

    pollTimer = setInterval(checkNewLines, 250);
  });
}
