import React, {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { newId } from "../core/id";
import { DaemonTransport, type SessionHistoryPayload, type WorkspaceChatInfo } from "../core/ai/DaemonTransport";
import { parseSessionHistory } from "../core/ai/historyParser";
import { deriveHydratedSessionStatus } from "../core/ai/planMode";
import { SessionEngine } from "../core/ai/SessionEngine";
import { parseReadinessOutput, READINESS_SCRIPT } from "../core/readiness";
import { CLI_DETECTION_SCRIPT, parseCliDetectionOutput, parseDaemonFromDetectionOutput } from "../core/cliDetection";
import { RunEngine } from "../core/runs/RunEngine";
import { NativeSshClient } from "../core/ssh/nativeSsh";
import { buildDaemonScript, buildToolScript } from "../core/tooling";
import { evaluateDaemonCompatibility, REQUIRED_DAEMON_VERSION } from "../core/daemonVersion";
import { getModelsForTool, type ModelOption } from "../core/modelOptions";
import type {
  AiSession,
  AuthMethod,
  DetectedToolsMap,
  PersistedState,
  PromptFlow,
  PromptTemplate,
  ReadinessReport,
  RunRecord,
  RunType,
  SshCredentials,
  TargetProfile,
  ToolAction,
  ToolName,
  Workspace,
} from "../core/types";
import { BUILT_IN_PROMPTS } from "../core/builtInPrompts";
import {
  deleteTargetCredentials,
  loadTargetCredentials,
  saveTargetCredentials,
} from "./secureStore";
import { getExpoPushToken } from "../core/notifications";
import { loadState, saveState } from "./storage";

const EMPTY_STATE: PersistedState = {
  version: 4,
  targets: [],
  runs: [],
  readinessByTarget: {},
  workspaces: [],
  sessions: [],
  promptTemplates: [],
  promptFlows: [],
  hiddenBuiltInPromptIds: [],
  showToolDetails: true,
  notificationsEnabled: true,
  speechLanguage: "en-US",
};

function upsertSession(sessions: AiSession[], session: AiSession): AiSession[] {
  const index = sessions.findIndex((s) => s.id === session.id);
  if (index < 0) {
    return [session, ...sessions].sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
  }
  const next = sessions.slice();
  next[index] = session;
  return next.sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
}

function upsertRun(runs: RunRecord[], run: RunRecord): RunRecord[] {
  const index = runs.findIndex((item) => item.id === run.id);
  if (index < 0) {
    return [run, ...runs].sort((a, b) => (a.startedAt > b.startedAt ? -1 : 1));
  }

  const next = runs.slice();
  next[index] = run;
  return next.sort((a, b) => (a.startedAt > b.startedAt ? -1 : 1));
}

function getHydratedContext(
  session: Pick<AiSession, "contextNeedsRefresh">,
  parsed: ReturnType<typeof parseSessionHistory>,
): Pick<
  AiSession,
  "contextStatus" | "contextUsedTokens" | "contextWindowTokens" | "contextPercentUsed" | "contextSource" | "contextLabel"
> {
  if (session.contextNeedsRefresh) {
    return {
      contextStatus: "unavailable",
      contextUsedTokens: undefined,
      contextWindowTokens: undefined,
      contextPercentUsed: undefined,
      contextSource: undefined,
      contextLabel: "Context N/A",
    };
  }

  return {
    contextStatus: parsed.contextStatus,
    contextUsedTokens: parsed.contextUsedTokens,
    contextWindowTokens: parsed.contextWindowTokens,
    contextPercentUsed: parsed.contextPercentUsed,
    contextSource: parsed.contextSource,
    contextLabel: parsed.contextLabel,
  };
}

function normalizeRemoteDirectory(input: string): string {
  const value = input.trim();
  if (!value) return "/";
  const isHomePath = value === "~" || value.startsWith("~/");
  const normalizedInput = isHomePath ? value.slice(1) : value;
  const parts = normalizedInput.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  if (isHomePath) {
    return stack.length > 0 ? `~/${stack.join("/")}` : "~";
  }
  return "/" + stack.join("/");
}

function basename(path: string): string {
  const normalized = normalizeRemoteDirectory(path);
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function isWorkspaceHostEligible(target: TargetProfile): { eligible: boolean; reason?: string } {
  const daemon = evaluateDaemonCompatibility(target.daemonInstalled === true, target.daemonVersion);
  if (!daemon.compatible) {
    return { eligible: false, reason: daemon.reason ?? "Daemon is not ready on this host." };
  }

  const tools = target.detectedTools;
  const hasSupportedTool = tools?.claude?.installed === true || tools?.codex?.installed === true;
  if (!hasSupportedTool) {
    return {
      eligible: false,
      reason: "Host must have Claude Code or Codex installed.",
    };
  }
  return { eligible: true };
}

function isTerminal(status: RunRecord["status"]): boolean {
  return ["completed", "failed", "cancelled", "timeout"].includes(status);
}

function assertDaemonCompatible(target: TargetProfile): void {
  if (target.daemonCompatible === true) return;

  if (target.daemonCompatible === false) {
    throw new Error(
      target.daemonCompatibilityReason ??
      `openvide-daemon ${target.daemonVersion ?? "unknown"} is not supported. Required version is ${REQUIRED_DAEMON_VERSION} or newer.`,
    );
  }

  const fallback = evaluateDaemonCompatibility(target.daemonInstalled === true, target.daemonVersion);
  if (!fallback.compatible) {
    throw new Error(
      target.daemonCompatibilityReason ??
      fallback.reason ??
      `openvide-daemon ${target.daemonVersion ?? "unknown"} is not supported. Required version is ${REQUIRED_DAEMON_VERSION} or newer.`,
    );
  }
}

interface AppStoreContextShape {
  ready: boolean;
  targets: TargetProfile[];
  runs: RunRecord[];
  workspaces: Workspace[];
  sessions: AiSession[];
  readinessByTarget: Record<string, ReadinessReport>;
  createTarget: (input: {
    label: string;
    host: string;
    port: number;
    username: string;
    tags: string[];
    authMethod: AuthMethod;
    credentials: SshCredentials;
  }) => Promise<TargetProfile>;
  updateTarget: (
    targetId: string,
    updates: Partial<Pick<TargetProfile, "label" | "host" | "port" | "username" | "tags">>,
  ) => Promise<void>;
  deleteTarget: (targetId: string) => Promise<void>;
  getTarget: (targetId: string) => TargetProfile | undefined;
  getRun: (runId: string) => RunRecord | undefined;
  listRunsByTarget: (targetId: string) => RunRecord[];
  subscribeRun: (runId: string, listener: (run: RunRecord) => void) => () => void;
  startCommandRun: (input: {
    targetId: string;
    command: string;
    timeoutSec: number;
    sourceManagedEnv: boolean;
    redactionValues?: string[];
  }) => Promise<RunRecord>;
  sendRunInput: (runId: string, input: string) => Promise<boolean>;
  startToolRun: (input: {
    targetId: string;
    tool: ToolName;
    action: ToolAction;
    timeoutSec: number;
  }) => Promise<RunRecord>;
  runConnectivityTest: (targetId: string, options?: { forceReconnect?: boolean }) => Promise<RunRecord>;
  runReadinessScan: (targetId: string) => Promise<{ run: RunRecord; report: ReadinessReport }>;
  testConnectionBeforeSave: (input: {
    host: string;
    port: number;
    username: string;
    authMethod: AuthMethod;
    credentials: SshCredentials;
  }) => Promise<{ success: boolean; error?: string }>;
  runCliDetection: (targetId: string) => Promise<DetectedToolsMap>;
  getWorkspaceHostEligibility: (targetId: string) => { eligible: boolean; reason?: string };
  createWorkspace: (input: { targetId: string; directory: string; name?: string }) => Promise<Workspace>;
  updateWorkspace: (workspaceId: string, updates: Partial<Pick<Workspace, "name" | "directory">>) => Promise<void>;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  getWorkspace: (workspaceId: string) => Workspace | undefined;
  listWorkspacesByTarget: (targetId: string) => Workspace[];
  listWorkspaceChats: (workspaceId: string) => Promise<WorkspaceChatInfo[]>;
  openWorkspaceChat: (workspaceId: string, workspaceChatId: string) => Promise<AiSession>;
  installDaemon: (targetId: string) => Promise<RunRecord>;
  startDaemonInstall: (targetId: string) => Promise<RunRecord>;
  cancelRun: (runId: string) => Promise<boolean>;
  showToolDetails: boolean;
  setShowToolDetails: (value: boolean) => void;
  notificationsEnabled: boolean;
  setNotificationsEnabled: (value: boolean) => void;
  speechLanguage: string;
  setSpeechLanguage: (value: string) => void;
  createDraftSession: (input: {
    targetId: string;
    workspaceId?: string;
    tool: ToolName;
    workingDirectory?: string;
    model?: string;
  }) => Promise<AiSession>;
  startAiSession: (input: {
    targetId: string;
    tool: ToolName;
    prompt: string;
    workingDirectory?: string;
    allowedTools?: string[];
    model?: string;
  }) => Promise<AiSession>;
  sendAiPrompt: (sessionId: string, prompt: string) => Promise<void>;
  cancelAiTurn: (sessionId: string) => Promise<boolean>;
  getAiSession: (sessionId: string) => AiSession | undefined;
  listSessionsByTarget: (targetId: string) => AiSession[];
  subscribeAiSession: (sessionId: string, listener: (session: AiSession) => void) => () => void;
  deleteSession: (sessionId: string) => Promise<void>;
  clearSessions: () => Promise<void>;
  updateSessionModel: (sessionId: string, model: string) => void;
  listSessionModels: (sessionId: string) => Promise<ModelOption[]>;
  updateSessionMode: (sessionId: string, mode: string) => void;
  compactSessionMessages: (sessionId: string) => void;
  clearSessionMessages: (sessionId: string) => void;
  importDaemonSessions: (targetId: string) => Promise<AiSession[]>;
  promptTemplates: PromptTemplate[];
  promptFlows: PromptFlow[];
  addPromptTemplate: (template: Omit<PromptTemplate, "id" | "isBuiltIn">) => void;
  updatePromptTemplate: (id: string, updates: Partial<Omit<PromptTemplate, "id" | "isBuiltIn">>) => void;
  deletePromptTemplate: (id: string) => void;
  reorderPromptTemplates: (orderedIds: string[]) => void;
  hideBuiltInPrompt: (id: string) => void;
  restoreBuiltInPrompts: () => void;
  hiddenBuiltInPromptIds: string[];
  updateSessionShowToolDetails: (sessionId: string, showToolDetails: boolean) => void;
  detachFromSession: (sessionId: string) => void;
  ensureSessionAttached: (sessionId: string) => void;
  refreshSessionHistory: (sessionId: string) => Promise<void>;
}

const AppStoreContext = createContext<AppStoreContextShape | null>(null);

export function AppStoreProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [state, setState] = useState<PersistedState>(EMPTY_STATE);
  const [ready, setReady] = useState(false);

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const commit = useCallback((updater: (prev: PersistedState) => PersistedState): void => {
    setState((prev) => {
      const next = updater(prev);
      stateRef.current = next;
      void saveState(next);
      return next;
    });
  }, []);

  const sshRef = useRef<NativeSshClient | null>(null);
  if (!sshRef.current) {
    sshRef.current = new NativeSshClient();
  }

  const engineRef = useRef<RunEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new RunEngine(sshRef.current, async (run) => {
      commit((prev) => ({
        ...prev,
        runs: upsertRun(prev.runs, run),
      }));
    });
  }

  const transportRef = useRef<DaemonTransport | null>(null);
  if (!transportRef.current) {
    transportRef.current = new DaemonTransport(sshRef.current);
  }

  const sessionEngineRef = useRef<SessionEngine | null>(null);
  if (!sessionEngineRef.current) {
    sessionEngineRef.current = new SessionEngine(transportRef.current, async (session) => {
      commit((prev) => ({
        ...prev,
        sessions: upsertSession(prev.sessions, session),
      }));
    });
  }

  // Push token: acquired once on startup, registered per-target before sessions.
  // pendingPushTargets stores targets that tried to register before the token
  // was available, so we can retry once it arrives.
  const pushTokenRef = useRef<string | null>(null);
  const pushTokenRegisteredTargets = useRef(new Set<string>());
  const pendingPushTargets = useRef<Map<string, { target: TargetProfile; credentials: SshCredentials }>>(new Map());

  // When the app returns to foreground after backgrounding, proactively
  // drop all cached SSH connections. iOS/Android kill idle TCP sockets while
  // the app is suspended, so the cached sessions are almost certainly dead.
  // Clearing them immediately avoids 30s timeout delays on the next command.
  useEffect(() => {
    let lastState: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener("change", (nextState) => {
      __DEV__ && console.log(`[OV:appstate] ${lastState} → ${nextState}`);
      if (lastState.match(/inactive|background/) && nextState === "active") {
        __DEV__ && console.log("[OV:appstate] Foregrounded — resetting SSH connections");
        // Clear push token registrations so they're re-sent after SSH reconnection
        pushTokenRegisteredTargets.current.clear();
        pendingPushTargets.current.clear();
        transportRef.current?.resetAllConnections().then(() => {
          // Re-attach to any running sessions whose SSH stream was killed
          for (const session of stateRef.current.sessions) {
            if (session.status === "running" && session.daemonSessionId) {
              if (sessionEngineRef.current!.hasActiveAttach(session.id)) continue;
              const target = stateRef.current.targets.find((t) => t.id === session.targetId);
              if (!target) continue;
              loadTargetCredentials(target.id).then((credentials) => {
                if (!credentials) return;
                void sessionEngineRef.current!.attachToRunningSession(session.id, {
                  target,
                  credentials,
                });
              }).catch(() => {});
            }
          }
        }).catch(() => {});
      }
      lastState = nextState;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let active = true;
    loadState()
      .then((loadedState) => {
        if (!active) {
          return;
        }
        setState(loadedState);
        sessionEngineRef.current!.notificationsEnabled = loadedState.notificationsEnabled ?? true;
        for (const session of loadedState.sessions) {
          sessionEngineRef.current!.loadSession(session);
        }
      })
      .catch(() => {
      })
      .finally(() => {
        if (active) {
          setReady(true);
        }
      });

    // Acquire Expo push token on startup (fire-and-forget).
    // If any targets already tried to register before the token was ready,
    // flush them now.
    getExpoPushToken()
      .then((token) => {
        if (token) {
          pushTokenRef.current = token;
          // Flush any targets that were pending registration
          for (const [targetId, { target, credentials }] of pendingPushTargets.current) {
            if (!pushTokenRegisteredTargets.current.has(targetId)) {
              pushTokenRegisteredTargets.current.add(targetId);
              __DEV__ && console.log(`[OV:push] Flushing pending registration for target ${targetId.slice(0, 12)}`);
              void transportRef.current?.registerPushToken(target, credentials, token);
            }
          }
          pendingPushTargets.current.clear();
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  const getTarget = useCallback(
    (targetId: string) => state.targets.find((target) => target.id === targetId),
    [state.targets],
  );

  const getRun = useCallback(
    (runId: string) => state.runs.find((run) => run.id === runId),
    [state.runs],
  );

  const listRunsByTarget = useCallback(
    (targetId: string) => state.runs.filter((run) => run.targetId === targetId),
    [state.runs],
  );

  const getWorkspace = useCallback(
    (workspaceId: string) => state.workspaces.find((workspace) => workspace.id === workspaceId),
    [state.workspaces],
  );

  const listWorkspacesByTarget = useCallback(
    (targetId: string) => state.workspaces.filter((workspace) => workspace.targetId === targetId),
    [state.workspaces],
  );

  const touchWorkspace = useCallback((workspaceId: string): void => {
    commit((prev) => ({
      ...prev,
      workspaces: prev.workspaces
        .map((workspace) =>
          workspace.id === workspaceId
            ? { ...workspace, updatedAt: new Date().toISOString() }
            : workspace,
        )
        .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1)),
    }));
  }, [commit]);

  const updateTargetStatus = useCallback((targetId: string, status: TargetProfile["lastStatus"], reason?: string): void => {
    commit((prev) => ({
      ...prev,
      targets: prev.targets.map((target) =>
        target.id === targetId
          ? {
            ...target,
            lastStatus: status,
            lastStatusReason: reason,
            lastSeenAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
          : target,
      ),
    }));
  }, [commit]);

  const waitForTerminalRun = useCallback(async (runId: string): Promise<RunRecord> => {
    const current = stateRef.current.runs.find((run) => run.id === runId);
    if (current && isTerminal(current.status)) {
      return current;
    }

    return await new Promise<RunRecord>((resolve) => {
      const unsubscribe = engineRef.current?.subscribe(runId, (run) => {
        if (!isTerminal(run.status)) {
          return;
        }
        unsubscribe?.();
        resolve(run);
      });
    });
  }, []);

  const startRun = useCallback(async (input: {
    targetId: string;
    type: RunType;
    command: string;
    timeoutSec: number;
    fallbackPhase: "connect" | "precheck" | "install" | "configure" | "verify";
    redactionValues?: string[];
    tool?: ToolName;
    action?: ToolAction;
  }): Promise<RunRecord> => {
    const target = stateRef.current.targets.find((item) => item.id === input.targetId);
    if (!target) {
      throw new Error("Target not found");
    }

    const credentials = await loadTargetCredentials(target.id);
    if (!credentials) {
      throw new Error("Target credentials are missing from secure store");
    }

    updateTargetStatus(target.id, "unknown");

    const run = await engineRef.current!.startRun({
      target,
      credentials,
      type: input.type,
      command: input.command,
      timeoutMs: input.timeoutSec * 1000,
      fallbackPhase: input.fallbackPhase,
      redactionValues: input.redactionValues,
      tool: input.tool,
      action: input.action,
    });

    commit((prev) => ({
      ...prev,
      runs: upsertRun(prev.runs, run),
    }));

    return run;
  }, [commit, updateTargetStatus]);

  const createTarget = useCallback(async (input: {
    label: string;
    host: string;
    port: number;
    username: string;
    tags: string[];
    authMethod: AuthMethod;
    credentials: SshCredentials;
  }): Promise<TargetProfile> => {
    const now = new Date().toISOString();
    const target: TargetProfile = {
      id: newId("target"),
      label: input.label,
      host: input.host,
      port: input.port,
      username: input.username,
      tags: input.tags,
      authMethod: input.authMethod,
      lastStatus: "unknown",
      createdAt: now,
      updatedAt: now,
    };

    await saveTargetCredentials(target.id, input.credentials);

    commit((prev) => ({
      ...prev,
      targets: [target, ...prev.targets],
    }));

    return target;
  }, [commit]);

  const updateTarget = useCallback(async (
    targetId: string,
    updates: Partial<Pick<TargetProfile, "label" | "host" | "port" | "username" | "tags">>,
  ): Promise<void> => {
    commit((prev) => ({
      ...prev,
      targets: prev.targets.map((target) =>
        target.id === targetId
          ? {
            ...target,
            ...updates,
            updatedAt: new Date().toISOString(),
          }
          : target,
      ),
    }));
  }, [commit]);

  const tryRemoveDaemonSession = useCallback(async (session: AiSession): Promise<void> => {
    if (!session.daemonSessionId) return;
    const target = stateRef.current.targets.find((t) => t.id === session.targetId);
    if (!target) return;
    try {
      const credentials = await loadTargetCredentials(target.id);
      if (!credentials) return;
      await transportRef.current!.removeSession(target, credentials, session.daemonSessionId);
    } catch {
    }
  }, []);

  const deleteTarget = useCallback(async (targetId: string): Promise<void> => {
    // Daemon cleanup must happen before deleteTargetCredentials since it needs SSH credentials
    const targetSessions = stateRef.current.sessions.filter((s) => s.targetId === targetId);
    for (const session of targetSessions) {
      void tryRemoveDaemonSession(session);
      await sessionEngineRef.current!.removeSession(session.id);
    }

    await engineRef.current!.resetTargetSession(targetId);
    await deleteTargetCredentials(targetId);

    commit((prev) => {
      const readinessByTarget = { ...prev.readinessByTarget };
      delete readinessByTarget[targetId];
      return {
        ...prev,
        targets: prev.targets.filter((target) => target.id !== targetId),
        runs: prev.runs.filter((run) => run.targetId !== targetId),
        workspaces: prev.workspaces.filter((workspace) => workspace.targetId !== targetId),
        sessions: prev.sessions.filter((session) => session.targetId !== targetId),
        readinessByTarget,
      };
    });
  }, [commit, tryRemoveDaemonSession]);

  const startCommandRun = useCallback(async (input: {
    targetId: string;
    command: string;
    timeoutSec: number;
    sourceManagedEnv: boolean;
    redactionValues?: string[];
  }): Promise<RunRecord> => {
    const normalizedUserCommand = input.command.replace(/\r\n/g, "\n").trim();

    const command = input.sourceManagedEnv
      ? `[ -f $HOME/.open-vide/env.sh ] && . $HOME/.open-vide/env.sh || true\n${normalizedUserCommand}`
      : normalizedUserCommand;

    return await startRun({
      targetId: input.targetId,
      type: "command",
      command,
      timeoutSec: input.timeoutSec,
      fallbackPhase: "connect",
      redactionValues: input.redactionValues,
    });
  }, [startRun]);

  const startToolRun = useCallback(async (input: {
    targetId: string;
    tool: ToolName;
    action: ToolAction;
    timeoutSec: number;
  }): Promise<RunRecord> => {
    const script = buildToolScript(input.tool, input.action);
    const fallbackPhase = input.action === "verify" ? "verify" : "install";

    return await startRun({
      targetId: input.targetId,
      type: "tool-action",
      tool: input.tool,
      action: input.action,
      command: script,
      timeoutSec: input.timeoutSec,
      fallbackPhase,
    });
  }, [startRun]);

  const runConnectivityTest = useCallback(async (
    targetId: string,
    options?: { forceReconnect?: boolean },
  ): Promise<RunRecord> => {
    if (options?.forceReconnect) {
      await engineRef.current!.resetTargetSession(targetId);
    }

    const run = await startRun({
      targetId,
      type: "connectivity",
      command: "echo 'STEP 1/2: SSH connectivity check'; uname -a; echo 'STEP 2/2: SSH reachable'",
      timeoutSec: 20,
      fallbackPhase: "connect",
    });
    const finalRun = await waitForTerminalRun(run.id);
    if (finalRun.status === "completed") {
      updateTargetStatus(targetId, "connected");
    } else {
      updateTargetStatus(targetId, "failed", finalRun.summary);
    }

    return finalRun;
  }, [startRun, updateTargetStatus, waitForTerminalRun]);

  const runReadinessScan = useCallback(async (targetId: string): Promise<{ run: RunRecord; report: ReadinessReport }> => {
    const run = await startRun({
      targetId,
      type: "readiness",
      command: READINESS_SCRIPT,
      timeoutSec: 45,
      fallbackPhase: "precheck",
    });

    const finalRun = await waitForTerminalRun(run.id);
    const stdout = finalRun.rawLogs.filter((line) => line.stream === "stdout").map((line) => line.text).join("\n");
    const stderr = finalRun.rawLogs.filter((line) => line.stream === "stderr").map((line) => line.text).join("\n");
    const report = parseReadinessOutput(targetId, stdout, stderr);

    commit((prev) => ({
      ...prev,
      readinessByTarget: {
        ...prev.readinessByTarget,
        [targetId]: report,
      },
    }));

    if (finalRun.status === "completed") {
      updateTargetStatus(targetId, "connected");
    } else {
      updateTargetStatus(targetId, "failed", finalRun.summary);
    }

    if (report.detectedTools) {
      commit((prev) => ({
        ...prev,
        targets: prev.targets.map((t) =>
          t.id === targetId
            ? { ...t, detectedTools: report.detectedTools, detectedToolsScannedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
            : t,
        ),
      }));
    }

    return { run: finalRun, report };
  }, [commit, startRun, updateTargetStatus, waitForTerminalRun]);

  const testConnectionBeforeSave = useCallback(async (input: {
    host: string;
    port: number;
    username: string;
    authMethod: AuthMethod;
    credentials: SshCredentials;
  }): Promise<{ success: boolean; error?: string }> => {
    const tempTarget: TargetProfile = {
      id: "temp_test",
      label: "Connection Test",
      host: input.host,
      port: input.port,
      username: input.username,
      tags: [],
      authMethod: input.authMethod,
      lastStatus: "unknown",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return await sshRef.current!.testConnection(tempTarget, input.credentials);
  }, []);

  const runCliDetection = useCallback(async (targetId: string): Promise<DetectedToolsMap> => {
    let run;
    try {
      run = await startRun({
        targetId,
        type: "readiness",
        command: CLI_DETECTION_SCRIPT,
        timeoutSec: 30,
        fallbackPhase: "precheck",
      });
    } catch (err) {
      // startRun can throw if credentials are missing or target not found
      const msg = err instanceof Error ? err.message : String(err);
      updateTargetStatus(targetId, "failed", msg);
      return {};
    }

    const finalRun = await waitForTerminalRun(run.id);
    const stdout = finalRun.rawLogs.filter((line) => line.stream === "stdout").map((line) => line.text).join("\n");
    const detectedTools = parseCliDetectionOutput(stdout);
    const daemonInfo = parseDaemonFromDetectionOutput(stdout);
    const daemonCompatibility = evaluateDaemonCompatibility(daemonInfo.installed, daemonInfo.version);

    commit((prev) => ({
      ...prev,
      targets: prev.targets.map((t) =>
        t.id === targetId
          ? {
            ...t,
            detectedTools,
            detectedToolsScannedAt: new Date().toISOString(),
            daemonInstalled: daemonInfo.installed,
            daemonVersion: daemonInfo.version,
            daemonCompatible: daemonCompatibility.compatible,
            daemonRequiredVersion: REQUIRED_DAEMON_VERSION,
            daemonCompatibilityReason: daemonCompatibility.reason,
            updatedAt: new Date().toISOString(),
          }
          : t,
      ),
    }));

    // SSH connected if the run actually executed (any terminal state except connection failure)
    if (finalRun.status === "completed" || finalRun.status === "failed" || finalRun.status === "timeout") {
      updateTargetStatus(targetId, "connected");
    } else {
      updateTargetStatus(targetId, "failed", finalRun.summary);
    }

    return detectedTools;
  }, [commit, startRun, updateTargetStatus, waitForTerminalRun]);

  const getWorkspaceHostEligibility = useCallback((targetId: string): { eligible: boolean; reason?: string } => {
    const target = stateRef.current.targets.find((t) => t.id === targetId);
    if (!target) return { eligible: false, reason: "Host not found." };
    return isWorkspaceHostEligible(target);
  }, []);

  const createWorkspace = useCallback(async (input: {
    targetId: string;
    directory: string;
    name?: string;
  }): Promise<Workspace> => {
    const target = stateRef.current.targets.find((t) => t.id === input.targetId);
    if (!target) {
      throw new Error("Target not found");
    }

    const eligibility = isWorkspaceHostEligible(target);
    if (!eligibility.eligible) {
      throw new Error(eligibility.reason ?? "Host is not eligible for workspace sessions.");
    }

    const directory = normalizeRemoteDirectory(input.directory);
    if (!directory || directory === "/") {
      throw new Error("Workspace directory is required.");
    }

    const duplicate = stateRef.current.workspaces.find(
      (w) => w.targetId === input.targetId && normalizeRemoteDirectory(w.directory) === directory,
    );
    if (duplicate) {
      throw new Error("A workspace for this host and directory already exists.");
    }

    const now = new Date().toISOString();
    const name = input.name?.trim() || basename(directory);
    const workspace: Workspace = {
      id: newId("workspace"),
      name,
      targetId: input.targetId,
      directory,
      createdAt: now,
      updatedAt: now,
    };

    commit((prev) => ({
      ...prev,
      workspaces: [workspace, ...prev.workspaces].sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1)),
    }));

    return workspace;
  }, [commit]);

  const updateWorkspace = useCallback(async (
    workspaceId: string,
    updates: Partial<Pick<Workspace, "name" | "directory">>,
  ): Promise<void> => {
    const existing = stateRef.current.workspaces.find((w) => w.id === workspaceId);
    if (!existing) throw new Error("Workspace not found");

    const nextDirectory = updates.directory
      ? normalizeRemoteDirectory(updates.directory)
      : existing.directory;
    const duplicate = stateRef.current.workspaces.find(
      (w) => w.id !== workspaceId &&
        w.targetId === existing.targetId &&
        normalizeRemoteDirectory(w.directory) === nextDirectory,
    );
    if (duplicate) {
      throw new Error("A workspace for this host and directory already exists.");
    }

    commit((prev) => ({
      ...prev,
      workspaces: prev.workspaces
        .map((workspace) =>
          workspace.id === workspaceId
            ? {
              ...workspace,
              name: updates.name?.trim() || workspace.name,
              directory: nextDirectory,
              updatedAt: new Date().toISOString(),
            }
            : workspace,
        )
        .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1)),
    }));
  }, [commit]);

  const deleteWorkspace = useCallback(async (workspaceId: string): Promise<void> => {
    const linkedSessions = stateRef.current.sessions
      .filter((session) => session.workspaceId === workspaceId);

    for (const session of linkedSessions) {
      void tryRemoveDaemonSession(session);
      await sessionEngineRef.current!.removeSession(session.id);
    }

    void AsyncStorage.removeItem(`open-vide/workspace-chats/${workspaceId}`);

    commit((prev) => ({
      ...prev,
      workspaces: prev.workspaces.filter((workspace) => workspace.id !== workspaceId),
      sessions: prev.sessions.filter((session) => session.workspaceId !== workspaceId),
    }));
  }, [commit, tryRemoveDaemonSession]);

  const listWorkspaceChats = useCallback(async (workspaceId: string): Promise<WorkspaceChatInfo[]> => {
    const workspace = stateRef.current.workspaces.find((w) => w.id === workspaceId);
    if (!workspace) throw new Error("Workspace not found");

    const target = stateRef.current.targets.find((t) => t.id === workspace.targetId);
    if (!target) throw new Error("Target not found");

    assertDaemonCompatible(target);

    const credentials = await loadTargetCredentials(target.id);
    if (!credentials) throw new Error("Target credentials are missing from secure store");

    const allSessions = await transportRef.current!.listWorkspaceSessions(
      target,
      credentials,
      workspace.directory,
    );
    return allSessions
      .filter((session) => session.tool === "claude" || session.tool === "codex")
      .sort((a, b) => (a.updatedAt ?? "").localeCompare(b.updatedAt ?? ""))
      .reverse();
  }, []);

  const openWorkspaceChat = useCallback(async (
    workspaceId: string,
    workspaceChatId: string,
  ): Promise<AiSession> => {
    const workspace = stateRef.current.workspaces.find((w) => w.id === workspaceId);
    if (!workspace) throw new Error("Workspace not found");

    const target = stateRef.current.targets.find((t) => t.id === workspace.targetId);
    if (!target) throw new Error("Target not found");
    const credentials = await loadTargetCredentials(target.id);
    if (!credentials) throw new Error("Target credentials are missing from secure store");

    const workspaceChats = await listWorkspaceChats(workspaceId);
    const workspaceChat = workspaceChats.find((session) => session.id === workspaceChatId);
    if (!workspaceChat) {
      throw new Error("Workspace chat not found.");
    }

    const toolName = workspaceChat.tool as ToolName;
    if (toolName !== "claude" && toolName !== "codex") {
      throw new Error(`Unsupported workspace chat tool '${workspaceChat.tool}'.`);
    }

    const existing = workspaceChat.daemonSessionId
      ? stateRef.current.sessions.find((session) => session.daemonSessionId === workspaceChat.daemonSessionId)
      : stateRef.current.sessions.find((session) =>
        session.targetId === workspace.targetId &&
        session.tool === toolName &&
        session.conversationId === workspaceChat.resumeId,
      );
    let imported: AiSession;
    if (existing) {
      if (existing.workspaceId !== workspaceId) {
        commit((prev) => ({
          ...prev,
          sessions: prev.sessions.map((session) =>
            session.id === existing.id
              ? { ...session, workspaceId, updatedAt: new Date().toISOString() }
              : session,
          ),
        }));
        imported = { ...existing, workspaceId, updatedAt: new Date().toISOString() };
      } else {
        imported = existing;
      }
    } else {
      imported = await sessionEngineRef.current!.importSession(
        workspaceChat.origin === "daemon" && workspaceChat.daemonSessionId
          ? {
            targetId: workspace.targetId,
            workspaceId: workspace.id,
            daemonSessionId: workspaceChat.daemonSessionId,
            tool: toolName,
            conversationId: workspaceChat.conversationId ?? workspaceChat.resumeId,
            workingDirectory: workspaceChat.workingDirectory,
            model: workspaceChat.model,
            daemonOutputOffset: workspaceChat.outputLines,
          }
          : {
            targetId: workspace.targetId,
            workspaceId: workspace.id,
            tool: toolName,
            conversationId: workspaceChat.resumeId,
            workingDirectory: workspaceChat.workingDirectory,
            model: workspaceChat.model,
          },
      );
    }

    try {
      const parseOptions = {
        messageLimit: 200,
        modelId: workspaceChat.model ?? imported.model,
      } as const;
      let daemonHistoryLineCount = imported.daemonOutputOffset;
      let parsed = undefined as ReturnType<typeof parseSessionHistory> | undefined;

      if (workspaceChat.origin === "daemon" && workspaceChat.daemonSessionId) {
        const daemonHistory = await transportRef.current!.getHistory(
          target,
          credentials,
          {
            daemonSessionId: workspaceChat.daemonSessionId,
            limitLines: 8000,
          },
        );
        daemonHistoryLineCount = daemonHistory.lineCount;
        parsed = parseSessionHistory(toolName, daemonHistory, parseOptions);

        // Prefer native history when available so opening a daemon-linked chat
        // still loads the full CLI resume history from disk.
        try {
          const nativeHistory = await transportRef.current!.getHistory(
            target,
            credentials,
            {
              tool: toolName,
              resumeId: workspaceChat.resumeId,
              cwd: workspace.directory,
              limitLines: 8000,
            },
          );
          const parsedNative = parseSessionHistory(toolName, nativeHistory, parseOptions);
          if (parsedNative.messages.length >= parsed.messages.length) {
            parsed = parsedNative;
          }
        } catch {
          // Native resume history may not exist for daemon-only turns.
        }
      } else {
        const history = await transportRef.current!.getHistory(
          target,
          credentials,
          {
            tool: toolName,
            resumeId: workspaceChat.resumeId,
            cwd: workspace.directory,
            limitLines: 8000,
          },
        );
        parsed = parseSessionHistory(toolName, history, parseOptions);
      }
      if (!parsed) {
        throw new Error("Failed to parse session history.");
      }
      const hydratedContext = getHydratedContext(imported, parsed);

      const baseHydratedStatus = workspaceChat.origin === "daemon"
        ? (workspaceChat.status === "running"
          ? "running"
          : workspaceChat.status === "failed"
            ? "failed"
            : workspaceChat.status === "cancelled"
              ? "cancelled"
              : "idle")
        : "idle";
      const hydratedStatus = deriveHydratedSessionStatus(baseHydratedStatus, parsed.messages);
      const hydrated = await sessionEngineRef.current!.hydrateSession(imported.id, {
        messages: parsed.messages,
        turns: parsed.turns,
        totalInputTokens: parsed.totalInputTokens,
        totalOutputTokens: parsed.totalOutputTokens,
        ...hydratedContext,
        status: hydratedStatus,
        daemonOutputOffset: daemonHistoryLineCount,
      });
      if (hydrated) {
        imported = hydrated;
      }
    } catch {
    }

    if (
      workspaceChat.origin === "daemon" &&
      workspaceChat.daemonSessionId &&
      workspaceChat.status === "running"
    ) {
      void sessionEngineRef.current!.attachToRunningSession(imported.id, {
        target,
        credentials,
      });
    }

    touchWorkspace(workspace.id);
    return imported;
  }, [commit, listWorkspaceChats, touchWorkspace]);

  const startDaemonInstall = useCallback(async (targetId: string): Promise<RunRecord> => {
    const script = buildDaemonScript("install");
    return await startRun({
      targetId,
      type: "tool-action",
      command: script,
      timeoutSec: 120,
      fallbackPhase: "install",
    });
  }, [startRun]);

  const installDaemon = useCallback(async (targetId: string): Promise<RunRecord> => {
    const run = await startDaemonInstall(targetId);
    const finalRun = await waitForTerminalRun(run.id);
    await runCliDetection(targetId);
    return finalRun;
  }, [startDaemonInstall, waitForTerminalRun, runCliDetection]);

  const cancelRun = useCallback(async (runId: string): Promise<boolean> => {
    return await engineRef.current!.cancelRun(runId, "user");
  }, []);

  const sendRunInput = useCallback(async (runId: string, input: string): Promise<boolean> => {
    return await engineRef.current!.sendInput(runId, input);
  }, []);

  const subscribeRun = useCallback((runId: string, listener: (run: RunRecord) => void): (() => void) => {
    return engineRef.current!.subscribe(runId, listener);
  }, []);

  const createDraftSession = useCallback(async (input: {
    targetId: string;
    workspaceId?: string;
    tool: ToolName;
    workingDirectory?: string;
    model?: string;
  }): Promise<AiSession> => {
    const session = await sessionEngineRef.current!.createSession({
      targetId: input.targetId,
      workspaceId: input.workspaceId,
      tool: input.tool,
      workingDirectory: input.workingDirectory,
      model: input.model,
    });
    if (input.workspaceId) {
      touchWorkspace(input.workspaceId);
    }
    return session;
  }, [touchWorkspace]);

  /** Fire-and-forget push token registration for a target (idempotent per foreground cycle) */
  const ensurePushTokenRegistered = useCallback((target: TargetProfile, credentials: SshCredentials): void => {
    if (pushTokenRegisteredTargets.current.has(target.id)) return;
    const token = pushTokenRef.current;
    if (!token) {
      // Token not ready yet — queue the target so we register once it arrives
      __DEV__ && console.log(`[OV:push] Token not ready, queuing target ${target.id.slice(0, 12)}`);
      pendingPushTargets.current.set(target.id, { target, credentials });
      return;
    }
    pushTokenRegisteredTargets.current.add(target.id);
    __DEV__ && console.log(`[OV:push] Registering push token with target ${target.id.slice(0, 12)}`);
    void transportRef.current?.registerPushToken(target, credentials, token);
  }, []);

  const startAiSession = useCallback(async (input: {
    targetId: string;
    tool: ToolName;
    prompt: string;
    workingDirectory?: string;
    allowedTools?: string[];
    model?: string;
  }): Promise<AiSession> => {
    const target = stateRef.current.targets.find((t) => t.id === input.targetId);
    if (!target) {
      throw new Error("Target not found");
    }
    assertDaemonCompatible(target);
    const credentials = await loadTargetCredentials(target.id);
    if (!credentials) {
      throw new Error("Target credentials are missing from secure store");
    }
    ensurePushTokenRegistered(target, credentials);
    const session = await sessionEngineRef.current!.startSession({
      target,
      credentials,
      tool: input.tool,
      prompt: input.prompt,
      workingDirectory: input.workingDirectory,
      allowedTools: input.allowedTools,
      model: input.model,
    });
    return session;
  }, [ensurePushTokenRegistered]);

  const sendAiPrompt = useCallback(async (sessionId: string, prompt: string): Promise<void> => {
    const session = stateRef.current.sessions.find((s) => s.id === sessionId);
    if (!session) {
      throw new Error("Session not found");
    }
    const target = stateRef.current.targets.find((t) => t.id === session.targetId);
    if (!target) {
      throw new Error("Target not found");
    }
    assertDaemonCompatible(target);
    const credentials = await loadTargetCredentials(target.id);
    if (!credentials) {
      throw new Error("Target credentials are missing from secure store");
    }
    ensurePushTokenRegistered(target, credentials);
    await sessionEngineRef.current!.sendPrompt(sessionId, { target, credentials, prompt });
    if (session.workspaceId) {
      touchWorkspace(session.workspaceId);
    }
  }, [touchWorkspace, ensurePushTokenRegistered]);

  const cancelAiTurn = useCallback(async (sessionId: string): Promise<boolean> => {
    return await sessionEngineRef.current!.cancelTurn(sessionId);
  }, []);

  const getAiSession = useCallback(
    (sessionId: string) => state.sessions.find((s) => s.id === sessionId),
    [state.sessions],
  );

  const listSessionsByTarget = useCallback(
    (targetId: string) => state.sessions.filter((s) => s.targetId === targetId),
    [state.sessions],
  );

  const subscribeAiSession = useCallback(
    (sessionId: string, listener: (session: AiSession) => void): (() => void) => {
      return sessionEngineRef.current!.subscribe(sessionId, listener);
    },
    [],
  );

  const deleteSession = useCallback(async (sessionId: string): Promise<void> => {
    const session = stateRef.current.sessions.find((s) => s.id === sessionId);
    if (session) {
      void tryRemoveDaemonSession(session);
    }
    await sessionEngineRef.current!.removeSession(sessionId);
    commit((prev) => ({
      ...prev,
      sessions: prev.sessions.filter((s) => s.id !== sessionId),
    }));
  }, [commit, tryRemoveDaemonSession]);

  const clearSessions = useCallback(async (): Promise<void> => {
    const allSessions = stateRef.current.sessions;
    for (const session of allSessions) {
      void tryRemoveDaemonSession(session);
      await sessionEngineRef.current!.removeSession(session.id);
    }
    commit((prev) => ({ ...prev, sessions: [] }));
  }, [commit, tryRemoveDaemonSession]);

  const updateSessionModel = useCallback((sessionId: string, model: string): void => {
    sessionEngineRef.current!.updateModel(sessionId, model);
    commit((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) =>
        s.id === sessionId
          ? {
            ...s,
            model,
            contextStatus: "unavailable",
            contextUsedTokens: undefined,
            contextWindowTokens: undefined,
            contextPercentUsed: undefined,
            contextSource: undefined,
            contextLabel: "Context N/A",
            contextNeedsRefresh: true,
            updatedAt: new Date().toISOString(),
          }
          : s,
      ),
    }));
  }, [commit]);

  const listSessionModels = useCallback(async (sessionId: string): Promise<ModelOption[]> => {
    const session = stateRef.current.sessions.find((s) => s.id === sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const fallback = getModelsForTool(session.tool);
    if (session.tool !== "codex") {
      return fallback;
    }

    const target = stateRef.current.targets.find((t) => t.id === session.targetId);
    if (!target) {
      return fallback;
    }

    const credentials = await loadTargetCredentials(target.id);
    if (!credentials) {
      return fallback;
    }

    try {
      const discovered = await transportRef.current!.listCodexModels(target, credentials);
      if (discovered.length === 0) {
        return fallback;
      }

      const models: ModelOption[] = discovered.map((item) => ({
        id: item.id,
        label: item.displayName || item.id,
        tool: "codex",
      }));

      if (session.model && !models.some((m) => m.id === session.model)) {
        return [{ id: session.model, label: session.model, tool: "codex" }, ...models];
      }
      return models;
    } catch (error) {
      __DEV__ && console.log(
        `[OV:models] listSessionModels fallback for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return fallback;
    }
  }, []);

  const updateSessionMode = useCallback((sessionId: string, mode: string): void => {
    sessionEngineRef.current!.updateMode(sessionId, mode);
    commit((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) =>
        s.id === sessionId ? { ...s, mode, updatedAt: new Date().toISOString() } : s,
      ),
    }));
  }, [commit]);

  const compactSessionMessages = useCallback((sessionId: string): void => {
    sessionEngineRef.current!.compactSession(sessionId);
    commit((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) =>
        s.id === sessionId
          ? {
            ...s,
            messages: [],
            turns: [],
            totalInputTokens: 0,
            totalOutputTokens: 0,
            contextStatus: "unavailable",
            contextUsedTokens: undefined,
            contextWindowTokens: undefined,
            contextPercentUsed: undefined,
            contextSource: undefined,
            contextLabel: "Context N/A",
            contextNeedsRefresh: false,
            status: "idle",
            updatedAt: new Date().toISOString(),
          }
          : s,
      ),
    }));
  }, [commit]);

  const clearSessionMessages = useCallback((sessionId: string): void => {
    sessionEngineRef.current!.clearSession(sessionId);
    commit((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) =>
        s.id === sessionId
          ? {
            ...s,
            messages: [],
            turns: [],
            conversationId: undefined,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            contextStatus: "unavailable",
            contextUsedTokens: undefined,
            contextWindowTokens: undefined,
            contextPercentUsed: undefined,
            contextSource: undefined,
            contextLabel: "Context N/A",
            contextNeedsRefresh: false,
            status: "idle",
            updatedAt: new Date().toISOString(),
          }
          : s,
      ),
    }));
  }, [commit]);

  const detachFromSession = useCallback((sessionId: string): void => {
    sessionEngineRef.current!.detachFromSession(sessionId);
  }, []);

  const ensureSessionAttached = useCallback((sessionId: string): void => {
    const session = stateRef.current.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    if (session.status !== "running") return;
    if (!session.daemonSessionId) return;
    if (sessionEngineRef.current!.hasActiveAttach(sessionId)) return;

    const target = stateRef.current.targets.find((t) => t.id === session.targetId);
    if (!target) return;

    loadTargetCredentials(target.id).then((credentials) => {
      if (!credentials) return;
      void sessionEngineRef.current!.attachToRunningSession(sessionId, {
        target,
        credentials,
      });
    }).catch(() => {
    });
  }, []);

  const refreshSessionHistory = useCallback(async (sessionId: string): Promise<void> => {
    const session = stateRef.current.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    // Need either a daemonSessionId or a conversationId (resumeId) to fetch history
    if (!session.daemonSessionId && !session.conversationId) return;
    // Skip if session is actively streaming — the live attach is already populating messages
    if (session.status === "running" && sessionEngineRef.current!.hasActiveAttach(sessionId)) return;

    const target = stateRef.current.targets.find((t) => t.id === session.targetId);
    if (!target) return;
    const credentials = await loadTargetCredentials(target.id);
    if (!credentials) return;

    const toolName = session.tool as "claude" | "codex" | "gemini";
    let history: SessionHistoryPayload;

    if (session.daemonSessionId) {
      // Daemon session: fetch by daemonSessionId, also try native history for richer data
      history = await transportRef.current!.getHistory(
        target,
        credentials,
        {
          daemonSessionId: session.daemonSessionId,
          limitLines: 8000,
        },
      );
      // If this session also has a native resumeId, try native history too
      // (native history may have more context from continuation files)
      if (session.conversationId && session.workingDirectory && (toolName === "claude" || toolName === "codex")) {
        try {
          const nativeHistory = await transportRef.current!.getHistory(
            target,
            credentials,
            {
              tool: toolName,
              resumeId: session.conversationId,
              cwd: session.workingDirectory,
              limitLines: 8000,
            },
          );
          const nativeParsed = parseSessionHistory(toolName, nativeHistory, {
            messageLimit: 200,
            modelId: session.model,
          });
          const daemonParsed = parseSessionHistory(toolName, history, {
            messageLimit: 200,
            modelId: session.model,
          });
          if (nativeParsed.messages.length >= daemonParsed.messages.length) {
            history = nativeHistory;
          }
        } catch {
          // Native history may not exist — use daemon history
        }
      }
    } else if (toolName === "claude" || toolName === "codex") {
      // Native-only session: fetch by tool + resumeId + cwd
      history = await transportRef.current!.getHistory(
        target,
        credentials,
        {
          tool: toolName,
          resumeId: session.conversationId!,
          cwd: session.workingDirectory,
          limitLines: 8000,
        },
      );
    } else {
      return; // Gemini doesn't have native session history
    }

    const parsed = parseSessionHistory(toolName, history, {
      messageLimit: 200,
      modelId: session.model,
    });
    const hydratedContext = getHydratedContext(session, parsed);
    const hydratedStatus = deriveHydratedSessionStatus(session.status, parsed.messages);

    await sessionEngineRef.current!.hydrateSession(sessionId, {
      messages: parsed.messages,
      turns: parsed.turns,
      totalInputTokens: parsed.totalInputTokens,
      totalOutputTokens: parsed.totalOutputTokens,
      ...hydratedContext,
      status: hydratedStatus,
      daemonOutputOffset: history.lineCount,
    });
  }, []);

  const importDaemonSessions = useCallback(async (targetId: string): Promise<AiSession[]> => {
    const target = stateRef.current.targets.find((t) => t.id === targetId);
    if (!target) throw new Error("Target not found");
    const credentials = await loadTargetCredentials(target.id);
    if (!credentials) throw new Error("Target credentials are missing from secure store");

    const daemonSessions = await transportRef.current!.listSessions(target, credentials);

    // Filter: only importable statuses, has conversationId, not already imported
    const existingDaemonIds = new Set(
      stateRef.current.sessions
        .filter((s) => s.daemonSessionId)
        .map((s) => s.daemonSessionId),
    );
    const importable = daemonSessions.filter((ds) => {
      if (!ds.conversationId) return false;
      if (existingDaemonIds.has(ds.id)) return false;
      const importableStatuses = ["idle", "failed", "cancelled", "interrupted"];
      return importableStatuses.includes(ds.status);
    });

    const imported: AiSession[] = [];
    for (const ds of importable) {
      const toolName = ds.tool as ToolName;
      if (!["claude", "codex", "gemini"].includes(toolName)) continue;
      const workspaceId = ds.workingDirectory
        ? stateRef.current.workspaces.find((workspace) =>
          workspace.targetId === targetId &&
          normalizeRemoteDirectory(workspace.directory) === normalizeRemoteDirectory(ds.workingDirectory!),
        )?.id
        : undefined;
      const session = await sessionEngineRef.current!.importSession({
        targetId,
        workspaceId,
        daemonSessionId: ds.id,
        tool: toolName,
        conversationId: ds.conversationId,
        workingDirectory: ds.workingDirectory,
        model: ds.model,
        daemonOutputOffset: ds.outputLines,
      });
      imported.push(session);
    }

    return imported;
  }, []);

  const setShowToolDetails = useCallback((value: boolean): void => {
    commit((prev) => ({ ...prev, showToolDetails: value }));
  }, [commit]);

  const setNotificationsEnabled = useCallback((value: boolean): void => {
    sessionEngineRef.current!.notificationsEnabled = value;
    commit((prev) => ({ ...prev, notificationsEnabled: value }));
  }, [commit]);

  const setSpeechLanguage = useCallback((value: string): void => {
    commit((prev) => ({ ...prev, speechLanguage: value }));
  }, [commit]);

  // Merge built-in prompts with user templates, filtering hidden ones
  const hiddenIds = state.hiddenBuiltInPromptIds ?? [];
  const promptTemplates = useMemo(() => {
    const visibleBuiltIns = BUILT_IN_PROMPTS.filter((t) => !hiddenIds.includes(t.id));
    const userTemplates = state.promptTemplates.filter((t) => !t.isBuiltIn);
    const merged = [...visibleBuiltIns, ...userTemplates];
    return merged.sort((a, b) => a.sortOrder - b.sortOrder);
  }, [state.promptTemplates, hiddenIds]);

  const promptFlows = state.promptFlows;

  const addPromptTemplate = useCallback((template: Omit<PromptTemplate, "id" | "isBuiltIn">): void => {
    const newTemplate: PromptTemplate = {
      ...template,
      id: newId("prompt"),
      isBuiltIn: false,
    };
    commit((prev) => ({
      ...prev,
      promptTemplates: [...prev.promptTemplates, newTemplate],
    }));
  }, [commit]);

  const updatePromptTemplate = useCallback((id: string, updates: Partial<Omit<PromptTemplate, "id" | "isBuiltIn">>): void => {
    commit((prev) => ({
      ...prev,
      promptTemplates: prev.promptTemplates.map((t) =>
        t.id === id ? { ...t, ...updates } : t,
      ),
    }));
  }, [commit]);

  const deletePromptTemplate = useCallback((id: string): void => {
    commit((prev) => ({
      ...prev,
      promptTemplates: prev.promptTemplates.filter((t) => t.id !== id),
    }));
  }, [commit]);

  const reorderPromptTemplates = useCallback((orderedIds: string[]): void => {
    commit((prev) => ({
      ...prev,
      promptTemplates: prev.promptTemplates.map((t) => {
        const idx = orderedIds.indexOf(t.id);
        return idx >= 0 ? { ...t, sortOrder: idx } : t;
      }),
    }));
  }, [commit]);

  const hideBuiltInPrompt = useCallback((id: string): void => {
    commit((prev) => ({
      ...prev,
      hiddenBuiltInPromptIds: [...(prev.hiddenBuiltInPromptIds ?? []).filter((x) => x !== id), id],
    }));
  }, [commit]);

  const restoreBuiltInPrompts = useCallback((): void => {
    commit((prev) => ({ ...prev, hiddenBuiltInPromptIds: [] }));
  }, [commit]);

  const updateSessionShowToolDetails = useCallback((sessionId: string, showToolDetails: boolean): void => {
    commit((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) =>
        s.id === sessionId ? { ...s, showToolDetails, updatedAt: new Date().toISOString() } : s,
      ),
    }));
  }, [commit]);

  const value = useMemo<AppStoreContextShape>(() => ({
    ready,
    targets: state.targets,
    runs: state.runs,
    workspaces: state.workspaces,
    sessions: state.sessions,
    readinessByTarget: state.readinessByTarget,
    createTarget,
    updateTarget,
    deleteTarget,
    getTarget,
    getRun,
    listRunsByTarget,
    subscribeRun,
    startCommandRun,
    sendRunInput,
    startToolRun,
    runConnectivityTest,
    runReadinessScan,
    testConnectionBeforeSave,
    runCliDetection,
    getWorkspaceHostEligibility,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
    getWorkspace,
    listWorkspacesByTarget,
    listWorkspaceChats,
    openWorkspaceChat,
    installDaemon,
    startDaemonInstall,
    cancelRun,
    createDraftSession,
    startAiSession,
    sendAiPrompt,
    cancelAiTurn,
    getAiSession,
    listSessionsByTarget,
    subscribeAiSession,
    deleteSession,
    clearSessions,
    updateSessionModel,
    listSessionModels,
    updateSessionMode,
    compactSessionMessages,
    clearSessionMessages,
    importDaemonSessions,
    showToolDetails: state.showToolDetails ?? true,
    setShowToolDetails,
    notificationsEnabled: state.notificationsEnabled ?? true,
    setNotificationsEnabled,
    speechLanguage: state.speechLanguage ?? "en-US",
    setSpeechLanguage,
    promptTemplates,
    promptFlows,
    addPromptTemplate,
    updatePromptTemplate,
    deletePromptTemplate,
    reorderPromptTemplates,
    hideBuiltInPrompt,
    restoreBuiltInPrompts,
    hiddenBuiltInPromptIds: hiddenIds,
    updateSessionShowToolDetails,
    detachFromSession,
    ensureSessionAttached,
    refreshSessionHistory,
  }), [
    ready,
    state.targets,
    state.runs,
    state.workspaces,
    state.sessions,
    state.readinessByTarget,
    state.showToolDetails,
    state.notificationsEnabled,
    state.speechLanguage,
    hiddenIds,
    promptTemplates,
    promptFlows,
    createTarget,
    updateTarget,
    deleteTarget,
    getTarget,
    getRun,
    listRunsByTarget,
    subscribeRun,
    startCommandRun,
    sendRunInput,
    startToolRun,
    runConnectivityTest,
    runReadinessScan,
    testConnectionBeforeSave,
    runCliDetection,
    getWorkspaceHostEligibility,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
    getWorkspace,
    listWorkspacesByTarget,
    listWorkspaceChats,
    openWorkspaceChat,
    installDaemon,
    startDaemonInstall,
    cancelRun,
    createDraftSession,
    startAiSession,
    sendAiPrompt,
    cancelAiTurn,
    getAiSession,
    listSessionsByTarget,
    subscribeAiSession,
    deleteSession,
    clearSessions,
    updateSessionModel,
    listSessionModels,
    updateSessionMode,
    compactSessionMessages,
    clearSessionMessages,
    importDaemonSessions,
    setShowToolDetails,
    setNotificationsEnabled,
    addPromptTemplate,
    updatePromptTemplate,
    deletePromptTemplate,
    reorderPromptTemplates,
    hideBuiltInPrompt,
    restoreBuiltInPrompts,
    updateSessionShowToolDetails,
    detachFromSession,
    ensureSessionAttached,
    refreshSessionHistory,
  ]);

  return <AppStoreContext value={value}>{children}</AppStoreContext>;
}

export function useAppStore(): AppStoreContextShape {
  const context = use(AppStoreContext);
  if (!context) {
    throw new Error("useAppStore must be used inside AppStoreProvider");
  }
  return context;
}
