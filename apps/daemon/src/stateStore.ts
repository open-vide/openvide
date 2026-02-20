import * as fs from "node:fs";
import * as path from "node:path";
import { daemonDir } from "./utils.js";
import type { DaemonState } from "./types.js";

const STATE_FILE = "state.json";

function statePath(): string {
  return path.join(daemonDir(), STATE_FILE);
}

export function loadState(): DaemonState {
  const p = statePath();
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw) as DaemonState;
    if (parsed.version === 1 && parsed.sessions) {
      return parsed;
    }
  } catch {
    // File missing or corrupt — start fresh
  }
  return { version: 1, sessions: {} };
}

export function saveState(state: DaemonState): void {
  const p = statePath();
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, p);
}
