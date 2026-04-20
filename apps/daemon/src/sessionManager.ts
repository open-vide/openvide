import { loadState, saveState } from "./stateStore.js";
import { ensureSessionDir, readOutputLines, removeSessionDir } from "./outputStore.js";
import { spawnTurn, patchCodexSessionSource, type RunningProcess } from "./processRunner.js";
import { spawnCodexAppServerTurn } from "./codexAppServerRunner.js";
import { sendPushNotification } from "./pushNotify.js";
import { purgeExpiredBridgeClientSessions } from "./bridgeAuth.js";
import { newId, nowISO, log, logError } from "./utils.js";
import type {
  DaemonState,
  PendingPermissionRequest,
  PermissionDecision,
  PermissionMode,
  PromptRecord,
  SessionExecutionBackend,
  SessionRecord,
  Tool,
  IpcResponse,
} from "./types.js";

const runningProcesses = new Map<string, RunningProcess>();
const pendingPermissionResponders = new Map<string, (decision: PermissionDecision) => Promise<void>>();
let state: DaemonState = { version: 1, sessions: {} };
let spawnCodexAppServerTurnImpl: typeof spawnCodexAppServerTurn = spawnCodexAppServerTurn;

export function setCodexAppServerTurnSpawnerForTest(spawner?: typeof spawnCodexAppServerTurn): void {
  spawnCodexAppServerTurnImpl = spawner ?? spawnCodexAppServerTurn;
}

const BUILT_IN_PROMPTS: PromptRecord[] = [
  {
    id: "builtin_explain",
    label: "Explain what you did",
    prompt: "Explain what you did",
    isBuiltIn: true,
  },
  {
    id: "builtin_changes",
    label: "Show changes",
    prompt: "Show me the changes you made",
    isBuiltIn: true,
  },
  {
    id: "builtin_tests",
    label: "Run tests",
    prompt: "Run the tests",
    isBuiltIn: true,
  },
  {
    id: "builtin_continue",
    label: "Continue",
    prompt: "Continue",
    isBuiltIn: true,
  },
  {
    id: "builtin_undo",
    label: "Undo last change",
    prompt: "Undo the last change you made",
    isBuiltIn: true,
  },
  {
    id: "builtin_review",
    label: "Review for bugs",
    prompt: "Review the code for bugs and potential issues",
    isBuiltIn: true,
  },
  {
    id: "builtin_refactor",
    label: "Suggest refactoring",
    prompt: "Suggest refactoring improvements for the code",
    isBuiltIn: true,
  },
  {
    id: "builtin_status",
    label: "Current status",
    prompt: "What is the current status? Summarize what has been done and what remains.",
    isBuiltIn: true,
  },
  {
    id: "builtin_commit",
    label: "Commit changes",
    prompt: "Commit the changes with an appropriate commit message",
    isBuiltIn: true,
  },
  {
    id: "builtin_explain_error",
    label: "Explain error",
    prompt: "Explain the error and suggest how to fix it",
    isBuiltIn: true,
  },
];

interface SessionCreationMeta {
  runKind?: "interactive" | "scheduled" | "team";
  scheduleId?: string;
  scheduleName?: string;
  teamId?: string;
  teamName?: string;
}

function extractLastProviderError(sessionId: string): string | undefined {
  const lines = readOutputLines(sessionId, 0);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const entry = JSON.parse(lines[i]!) as { t?: string; line?: string };
      if ((entry.t !== "o" && entry.t !== "e") || !entry.line) continue;
      try {
        const parsed = JSON.parse(entry.line) as {
          type?: string;
          message?: string;
          error?: string | { message?: string };
        };
        if (parsed.type === "error" && typeof parsed.message === "string" && parsed.message.trim()) {
          return parsed.message.trim();
        }
        if (parsed.type === "turn.failed") {
          if (typeof parsed.error === "string" && parsed.error.trim()) {
            return parsed.error.trim();
          }
          if (
            parsed.error
            && typeof parsed.error === "object"
            && typeof parsed.error.message === "string"
            && parsed.error.message.trim()
          ) {
            return parsed.error.message.trim();
          }
        }
      } catch {
        if (entry.t === "e" && entry.line.trim()) {
          return entry.line.trim();
        }
      }
    } catch {
      // Ignore malformed output entries.
    }
  }
  return undefined;
}

function defaultExecutionBackend(
  tool: Tool,
  conversationId?: string,
  outputLines = 0,
  permissionMode: PermissionMode = "auto",
): SessionExecutionBackend {
  if (tool === "codex" && permissionMode === "ask") {
    return "codex_app_server";
  }
  if (tool === "codex" && conversationId && outputLines === 0) {
    return "codex_app_server";
  }
  return "cli";
}

function parsePermissionMode(value: unknown, tool?: Tool): PermissionMode {
  if (value === "ask" || value === "auto") return value;
  if (tool === "codex" && process.env.OPENVIDE_CODEX_PERMISSION_MODE === "ask") {
    return "ask";
  }
  return "auto";
}

function permissionKey(sessionId: string, requestId: string): string {
  return `${sessionId}:${requestId}`;
}

function clearPermissionRespondersForSession(sessionId: string): void {
  const prefix = `${sessionId}:`;
  for (const key of [...pendingPermissionResponders.keys()]) {
    if (key.startsWith(prefix)) {
      pendingPermissionResponders.delete(key);
    }
  }
}

// ── State access ──

export function getState(): DaemonState {
  return state;
}

export function init(): void {
  state = loadState();
  state.prompts = Array.isArray(state.prompts) ? state.prompts : [];
  let needsPersist = false;

  if (state.bridge && purgeExpiredBridgeClientSessions(state.bridge)) {
    needsPersist = true;
  }

  for (const team of Object.values(state.teams ?? {})) {
    for (const member of team.members) {
      const session = state.sessions[member.sessionId];
      if (!session || session.pendingRemoval) continue;
      if (session.runKind !== "team" || session.teamId !== team.id || session.teamName !== team.name) {
        session.runKind = "team";
        session.teamId = team.id;
        session.teamName = team.name;
        needsPersist = true;
      }
    }
  }

  // Mark any previously-running sessions as interrupted
  for (const [id, session] of Object.entries(state.sessions)) {
    if (session.pendingRemoval) {
      removeSessionDir(id);
      delete state.sessions[id];
      continue;
    }
    if (!session.permissionMode) {
      session.permissionMode = parsePermissionMode(undefined, session.tool);
      needsPersist = true;
    }
    if (session.status === "running" || session.status === "awaiting_approval") {
      session.status = "interrupted";
      session.pid = undefined;
      session.updatedAt = nowISO();
      if (session.pendingPermission?.status === "pending") {
        session.pendingPermission = {
          ...session.pendingPermission,
          status: "cancelled",
        };
      }
      if (session.lastTurn && !session.lastTurn.endedAt) {
        session.lastTurn.endedAt = nowISO();
        session.lastTurn.error = "daemon restarted";
      }
    }
    if (!session.executionBackend) {
      session.executionBackend = defaultExecutionBackend(
        session.tool,
        session.conversationId,
        session.outputLines,
        session.permissionMode,
      );
      needsPersist = true;
    }
  }

  if (needsPersist) {
    persist();
  } else {
    saveState(state);
  }
  log(`Loaded ${Object.keys(state.sessions).length} sessions`);
}

export function persist(): void {
  saveState(state);
}

// ── Prompt library ──

export function listPrompts(): PromptRecord[] {
  const customPrompts = (state.prompts ?? [])
    .map((prompt) => ({ ...prompt, isBuiltIn: false }))
    .sort((left, right) => {
      const leftTs = left.updatedAt ?? left.createdAt ?? "";
      const rightTs = right.updatedAt ?? right.createdAt ?? "";
      return leftTs.localeCompare(rightTs);
    });
  return [...BUILT_IN_PROMPTS, ...customPrompts];
}

export function addPrompt(label: string, prompt: string): PromptRecord {
  const now = nowISO();
  const record: PromptRecord = {
    id: newId("prompt"),
    label,
    prompt,
    isBuiltIn: false,
    createdAt: now,
    updatedAt: now,
  };
  state.prompts = [...(state.prompts ?? []), record];
  persist();
  return record;
}

export function removePrompt(id: string): boolean {
  const prompts = state.prompts ?? [];
  const next = prompts.filter((prompt) => prompt.id !== id);
  if (next.length === prompts.length) {
    return false;
  }
  state.prompts = next;
  persist();
  return true;
}

// ── Push token ──

export function getPushToken(): string | undefined {
  return state.pushToken;
}

export function setPushToken(token: string): void {
  state.pushToken = token;
  persist();
  log(`Push token set: ${token.slice(0, 30)}...`);
}

// ── Session CRUD ──

export function createSession(
  tool: Tool,
  workingDirectory: string,
  model?: string,
  autoAccept?: boolean,
  conversationId?: string,
  permissionModeInput?: PermissionMode,
  metadata?: SessionCreationMeta,
): SessionRecord {
  const id = newId("ses");
  const now = nowISO();
  const permissionMode = parsePermissionMode(permissionModeInput, tool);

  const session: SessionRecord = {
    id,
    tool,
    status: "idle",
    executionBackend: defaultExecutionBackend(tool, conversationId, 0, permissionMode),
    permissionMode,
    runKind: metadata?.runKind ?? "interactive",
    scheduleId: metadata?.scheduleId,
    scheduleName: metadata?.scheduleName,
    teamId: metadata?.teamId,
    teamName: metadata?.teamName,
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

export function updateSession(
  id: string,
  updates: Partial<Pick<SessionRecord, "workingDirectory" | "model" | "runKind" | "teamId" | "teamName" | "scheduleId" | "scheduleName">>,
): SessionRecord | undefined {
  const session = state.sessions[id];
  if (!session) return undefined;
  Object.assign(session, updates);
  session.updatedAt = nowISO();
  persist();
  return session;
}

export function listSessions(): SessionRecord[] {
  return Object.values(state.sessions).filter((session) => !session.pendingRemoval);
}

export function listDismissedNativeIds(): string[] {
  return [...(state.dismissedNativeIds ?? [])];
}

export function dismissNativeSession(id: string): void {
  const current = state.dismissedNativeIds ?? [];
  if (current.includes(id)) return;
  state.dismissedNativeIds = [...current, id];
  persist();
  log(`Dismissed native session ${id}`);
}

export function removeSession(id: string): boolean {
  // Native sessions (e.g. "codex:xxx", "claude:xxx") live in the native tool's
  // own storage and are re-imported on every list. To make "delete" stick, we
  // track their IDs in a dismissed set and filter them from native listings.
  if (id.startsWith("codex:") || id.startsWith("claude:")) {
    dismissNativeSession(id);
    return true;
  }
  const session = state.sessions[id];
  if (!session) return false;

  // Kill process if running
  if (session.status === "running" || session.status === "awaiting_approval") {
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
  clearPermissionRespondersForSession(id);
  persist();

  log(`Removed session ${id}`);
  return true;
}

// ── Turn execution ──

export function sendTurn(id: string, prompt: string, turnOpts?: { mode?: string; model?: string }): IpcResponse {
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
  session.pendingPermission = undefined;
  clearPermissionRespondersForSession(id);
  session.lastTurn = {
    prompt,
    startedAt: nowISO(),
  };

  // Apply per-turn model override if provided
  const effectiveModel = turnOpts?.model ?? session.model;
  if (effectiveModel !== session.model) {
    session.model = effectiveModel;
  }

  let lastDeltaPersistTime = Date.now();
  const handleOutputDelta = (lines: number, bytes: number): void => {
    session.outputLines += lines;
    session.outputBytes += bytes;
    session.updatedAt = nowISO();
    // Persist every 2s so outputLines/outputBytes survive daemon crashes
    const now = Date.now();
    if (now - lastDeltaPersistTime >= 2000) {
      lastDeltaPersistTime = now;
      persist();
    }
  };

  const startRunner = (backend: SessionExecutionBackend): RunningProcess => {
    const onFinished = (result: { exitCode: number | null; conversationId?: string; resumeUnsupported?: boolean; fallbackToCli?: boolean }): void => {
      runningProcesses.delete(id);
      session.pid = undefined;

      if (result.fallbackToCli && session.tool === "codex" && backend === "codex_app_server") {
        if (session.permissionMode === "ask") {
          session.status = "failed";
          session.pid = undefined;
          if (session.lastTurn) {
            session.lastTurn.endedAt = nowISO();
            session.lastTurn.exitCode = result.exitCode ?? 1;
            session.lastTurn.error = "Codex Ask mode requires app-server approval support; refusing CLI auto fallback.";
          }
          session.updatedAt = nowISO();
          clearPermissionRespondersForSession(id);
          persist();
          return;
        }
        session.executionBackend = "cli";
        session.updatedAt = nowISO();
        const fallbackProc = startRunner("cli");
        runningProcesses.set(id, fallbackProc);
        session.pid = fallbackProc.pid ?? fallbackProc.child?.pid;
        persist();
        return;
      }

      if (session.pendingRemoval) {
        removeSessionDir(id);
        delete state.sessions[id];
        clearPermissionRespondersForSession(id);
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
      if (result.resumeUnsupported && session.tool === "codex") {
        // Avoid repeated failing resume attempts on older Codex CLI builds.
        session.conversationId = undefined;
        session.executionBackend = "cli";
      }

      // State transition
      if (session.status === "cancelled") {
        // Already cancelled — keep cancelled status
      } else if (result.exitCode === 0) {
        session.status = "idle"; // Ready for next turn
        // Patch Codex exec sessions so they appear in `codex resume` picker
        if (session.tool === "codex" && result.conversationId && session.executionBackend !== "codex_app_server") {
          patchCodexSessionSource(result.conversationId);
        }
      } else {
        session.status = "failed";
        if (session.lastTurn) {
          session.lastTurn.error = extractLastProviderError(id) ?? `Process exited with code ${result.exitCode}`;
        }
      }
      if (session.pendingPermission?.status === "pending") {
        session.pendingPermission = {
          ...session.pendingPermission,
          status: session.status === "cancelled" ? "cancelled" : "expired",
        };
      }
      clearPermissionRespondersForSession(id);

      session.updatedAt = nowISO();
      persist();

      // Send push notification if token is registered and session completed or failed
      if (state.pushToken && (session.status === "idle" || session.status === "failed")) {
        const toolLabel = session.tool.charAt(0).toUpperCase() + session.tool.slice(1);
        if (session.status === "idle") {
          sendPushNotification(
            state.pushToken,
            `${toolLabel} session completed`,
            session.lastTurn?.prompt?.slice(0, 100) ?? "The AI session has finished.",
            { sessionId: id, type: "session_complete" },
          );
        } else {
          sendPushNotification(
            state.pushToken,
            `${toolLabel} session failed`,
            (session.lastTurn?.error ?? "Unknown error").slice(0, 200),
            { sessionId: id, type: "session_failed" },
          );
        }
      }
    };

    if (backend === "codex_app_server") {
      return spawnCodexAppServerTurnImpl(
        session,
        prompt,
        { mode: turnOpts?.mode, model: effectiveModel, permissionMode: session.permissionMode ?? "auto" },
        handleOutputDelta,
        (request, responder) => {
          session.pendingPermission = request;
          session.status = "awaiting_approval";
          session.updatedAt = nowISO();
          pendingPermissionResponders.set(permissionKey(id, request.requestId), responder);
          persist();
        },
        (requestId, status) => {
          if (session.pendingPermission?.requestId === requestId) {
            session.pendingPermission = {
              ...session.pendingPermission,
              status,
            };
          }
          if (session.status === "awaiting_approval") {
            session.status = status === "cancelled" ? "cancelled" : "running";
          }
          session.updatedAt = nowISO();
          pendingPermissionResponders.delete(permissionKey(id, requestId));
          persist();
        },
        onFinished,
      );
    }

    return spawnTurn(
      session,
      prompt,
      { mode: turnOpts?.mode, model: effectiveModel },
      handleOutputDelta,
      onFinished,
    );
  };

  const proc = startRunner(session.executionBackend ?? "cli");

  runningProcesses.set(id, proc);
  session.pid = proc.pid ?? proc.child?.pid;
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
    if (session.status === "running" || session.status === "awaiting_approval") {
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

export async function respondToPermission(
  id: string,
  requestId: string,
  decision: PermissionDecision,
): Promise<IpcResponse> {
  const session = state.sessions[id];
  if (!session) {
    return { ok: false, error: `Session ${id} not found` };
  }

  const pending = session.pendingPermission;
  if (!pending || pending.requestId !== requestId) {
    return { ok: false, error: `Permission request ${requestId} not found for session ${id}` };
  }

  if (pending.status !== "pending") {
    return { ok: true, session: { ...session } };
  }

  const responder = pendingPermissionResponders.get(permissionKey(id, requestId));
  if (!responder) {
    return { ok: false, error: `Permission request ${requestId} is not attached to a running Codex process` };
  }

  try {
    await responder(decision);
    session.pendingPermission = {
      ...pending,
      status: decision === "approve_once"
        ? "approved"
        : decision === "reject"
          ? "rejected"
          : "cancelled",
    };
    if (session.status === "awaiting_approval") {
      session.status = decision === "abort_run" ? "cancelled" : "running";
    }
    session.updatedAt = nowISO();
    pendingPermissionResponders.delete(permissionKey(id, requestId));
    persist();
    return { ok: true, session: { ...session } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
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
    if (session.status !== "running" && session.status !== "awaiting_approval") {
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
