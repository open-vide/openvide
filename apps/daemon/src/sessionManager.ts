import { loadState, saveState } from "./stateStore.js";
import { ensureSessionDir, removeSessionDir } from "./outputStore.js";
import { spawnTurn, type RunningProcess } from "./processRunner.js";
import { newId, nowISO, log, logError } from "./utils.js";
import type { DaemonState, SessionRecord, SessionStatus, Tool, IpcResponse } from "./types.js";

const runningProcesses = new Map<string, RunningProcess>();
let state: DaemonState = { version: 1, sessions: {} };

// ── State access ──

export function getState(): DaemonState {
  return state;
}

export function init(): void {
  state = loadState();

  // Mark any previously-running sessions as interrupted
  for (const [id, session] of Object.entries(state.sessions)) {
    if (session.pendingRemoval) {
      removeSessionDir(id);
      delete state.sessions[id];
      continue;
    }
    if (session.status === "running") {
      session.status = "interrupted";
      session.pid = undefined;
      session.updatedAt = nowISO();
      if (session.lastTurn && !session.lastTurn.endedAt) {
        session.lastTurn.endedAt = nowISO();
        session.lastTurn.error = "daemon restarted";
      }
    }
  }

  persist();
  log(`Loaded ${Object.keys(state.sessions).length} sessions`);
}

export function persist(): void {
  saveState(state);
}

// ── Session CRUD ──

export function createSession(
  tool: Tool,
  workingDirectory: string,
  model?: string,
  autoAccept?: boolean,
  conversationId?: string,
): SessionRecord {
  const id = newId("ses");
  const now = nowISO();

  const session: SessionRecord = {
    id,
    tool,
    status: "idle",
    workingDirectory,
    model,
    autoAccept,
    conversationId,
    createdAt: now,
    updatedAt: now,
    outputLines: 0,
    outputBytes: 0,
  };

  ensureSessionDir(id);
  state.sessions[id] = session;
  persist();

  log(`Created session ${id} (${tool})`);
  return session;
}

export function getSession(id: string): SessionRecord | undefined {
  return state.sessions[id];
}

export function listSessions(): SessionRecord[] {
  return Object.values(state.sessions).filter((session) => !session.pendingRemoval);
}

export function removeSession(id: string): boolean {
  const session = state.sessions[id];
  if (!session) return false;

  // Kill process if running
  if (session.status === "running") {
    session.pendingRemoval = true;
    session.updatedAt = nowISO();
    persist();
    cancelSession(id);
    if (!runningProcesses.has(id)) {
      removeSessionDir(id);
      delete state.sessions[id];
      persist();
      log(`Removed session ${id}`);
      return true;
    }
    log(`Marked session ${id} for removal after process exit`);
    return true;
  }

  removeSessionDir(id);
  delete state.sessions[id];
  persist();

  log(`Removed session ${id}`);
  return true;
}

// ── Turn execution ──

export function sendTurn(id: string, prompt: string): IpcResponse {
  const session = state.sessions[id];
  if (!session) {
    return { ok: false, error: `Session ${id} not found` };
  }
  if (session.pendingRemoval) {
    return { ok: false, error: `Session ${id} is being removed` };
  }

  if (session.status === "running") {
    return { ok: false, error: `Session ${id} is already running` };
  }

  // Allow sending to idle, failed, cancelled, interrupted sessions
  if (session.status !== "idle" && session.status !== "failed" &&
      session.status !== "cancelled" && session.status !== "interrupted") {
    return { ok: false, error: `Session ${id} is in ${session.status} state, cannot send` };
  }

  session.status = "running";
  session.updatedAt = nowISO();
  session.lastTurn = {
    prompt,
    startedAt: nowISO(),
  };

  const proc = spawnTurn(
    session,
    prompt,
    (lines, bytes) => {
      session.outputLines += lines;
      session.outputBytes += bytes;
      session.updatedAt = nowISO();
      // Persist periodically (debounced in practice by the event loop)
    },
    (result) => {
      runningProcesses.delete(id);
      session.pid = undefined;

      if (session.pendingRemoval) {
        removeSessionDir(id);
        delete state.sessions[id];
        persist();
        log(`Removed session ${id} after process exit`);
        return;
      }

      if (session.lastTurn) {
        session.lastTurn.endedAt = nowISO();
        session.lastTurn.exitCode = result.exitCode ?? 1;
      }

      if (result.conversationId) {
        session.conversationId = result.conversationId;
      }

      // State transition
      if (session.status === "cancelled") {
        // Already cancelled — keep cancelled status
      } else if (result.exitCode === 0) {
        session.status = "idle"; // Ready for next turn
      } else {
        session.status = "failed";
        if (session.lastTurn) {
          session.lastTurn.error = `Process exited with code ${result.exitCode}`;
        }
      }

      session.updatedAt = nowISO();
      persist();
    },
  );

  runningProcesses.set(id, proc);
  session.pid = proc.child.pid;
  persist();

  return { ok: true, session: { ...session } };
}

export function cancelSession(id: string): IpcResponse {
  const session = state.sessions[id];
  if (!session) {
    return { ok: false, error: `Session ${id} not found` };
  }

  const proc = runningProcesses.get(id);
  if (!proc) {
    if (session.status === "running") {
      // Process gone but status stuck — fix it
      session.status = "cancelled";
      session.pid = undefined;
      session.updatedAt = nowISO();
      persist();
    }
    return { ok: true, session: { ...session } };
  }

  session.status = "cancelled";
  session.updatedAt = nowISO();
  persist();

  // SIGINT first, SIGTERM after 3s
  proc.kill("SIGINT");
  setTimeout(() => {
    if (runningProcesses.has(id)) {
      proc.kill("SIGTERM");
    }
  }, 3000);

  return { ok: true, session: { ...session } };
}

// ── Shutdown ──

export function shutdownAll(): Promise<void> {
  const running = [...runningProcesses.entries()];
  if (running.length === 0) {
    persist();
    return Promise.resolve();
  }

  log(`Shutting down ${running.length} running processes...`);

  for (const [, proc] of running) {
    proc.kill("SIGTERM");
  }

  return new Promise((resolve) => {
    const deadline = setTimeout(() => {
      // SIGKILL any remaining
      for (const [id, proc] of runningProcesses) {
        logError(`Force-killing session ${id}`);
        proc.kill("SIGKILL");
      }
      persist();
      resolve();
    }, 5000);

    const check = setInterval(() => {
      if (runningProcesses.size === 0) {
        clearInterval(check);
        clearTimeout(deadline);
        persist();
        resolve();
      }
    }, 100);
  });
}

export function getActiveCount(): number {
  return runningProcesses.size;
}

export async function waitForIdle(id: string, timeoutMs = 30000): Promise<IpcResponse> {
  const started = Date.now();
  const pollMs = 200;

  while (Date.now() - started < timeoutMs) {
    const session = state.sessions[id];
    if (!session) {
      return { ok: false, error: `Session ${id} not found` };
    }
    if (session.status !== "running") {
      return { ok: true, session: { ...session } };
    }
    await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
  }

  const session = state.sessions[id];
  if (!session) {
    return { ok: false, error: `Session ${id} not found` };
  }
  return { ok: true, session: { ...session }, timedOut: true };
}
