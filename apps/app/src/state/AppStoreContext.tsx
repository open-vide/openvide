import React, {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { newId } from "../core/id";
import { DaemonTransport, type WorkspaceChatInfo } from "../core/ai/DaemonTransport";
import { parseSessionHistory } from "../core/ai/historyParser";
import { SessionEngine } from "../core/ai/SessionEngine";
import { parseReadinessOutput, READINESS_SCRIPT } from "../core/readiness";
import { CLI_DETECTION_SCRIPT, parseCliDetectionOutput, parseDaemonFromDetectionOutput } from "../core/cliDetection";
import { RunEngine } from "../core/runs/RunEngine";
import { NativeSshClient } from "../core/ssh/nativeSsh";
import { buildDaemonScript, buildToolScript } from "../core/tooling";
import { evaluateDaemonCompatibility, REQUIRED_DAEMON_VERSION } from "../core/daemonVersion";
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
import { loadState, saveState } from "./storage";

const EMPTY_STATE: PersistedState = {
  version: 3,
  targets: [],
  runs: [],
  readinessByTarget: {},
  workspaces: [],
  sessions: [],
  promptTemplates: [],
  promptFlows: [],
  autoAcceptTools: false,
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
  cancelRun: (runId: string) => Promise<boolean>;
  autoAcceptTools: boolean;
  setAutoAcceptTools: (value: boolean) => void;
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
  compactSessionMessages: (sessionId: string) => void;
  clearSessionMessages: (sessionId: string) => void;
  importDaemonSessions: (targetId: string) => Promise<AiSession[]>;
  promptTemplates: PromptTemplate[];
  promptFlows: PromptFlow[];
  addPromptTemplate: (template: Omit<PromptTemplate, "id" | "isBuiltIn">) => void;
  updatePromptTemplate: (id: string, updates: Partial<Omit<PromptTemplate, "id" | "isBuiltIn">>) => void;
  deletePromptTemplate: (id: string) => void;
  reorderPromptTemplates: (orderedIds: string[]) => void;
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

  useEffect(() => {
    let active = true;
    console.log("[OV:store] initializing — loading persisted state");

    loadState()
      .then((loadedState) => {
        if (!active) {
          return;
        }
        console.log("[OV:store] state loaded, hydrating SessionEngine with", loadedState.sessions.length, "sessions");
        setState(loadedState);
        sessionEngineRef.current!.notificationsEnabled = loadedState.notificationsEnabled ?? true;
        for (const session of loadedState.sessions) {
          sessionEngineRef.current!.loadSession(session);
        }
      })
      .catch((err) => {
        console.error("[OV:store] loadState failed:", err);
      })
      .finally(() => {
        if (active) {
          console.log("[OV:store] ready=true");
          setReady(true);
        }
      });

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
    console.log("[OV:store] startRun:", input.type, "targetId=" + input.targetId, "knownTargets=" + stateRef.current.targets.map((t) => t.id).join(","));
    const target = stateRef.current.targets.find((item) => item.id === input.targetId);
    if (!target) {
      console.error("[OV:store] startRun FAILED: target not found. targetId=" + input.targetId, "available:", stateRef.current.targets.length);
      throw new Error("Target not found");
    }
    console.log("[OV:store] startRun: target found:", target.label, target.host + ":" + target.port);

    const credentials = await loadTargetCredentials(target.id);
    if (!credentials) {
      console.error("[OV:store] startRun FAILED: no credentials in secure store for", target.id);
      throw new Error("Target credentials are missing from secure store");
    }
    console.log("[OV:store] startRun: credentials loaded, hasPassword=" + !!credentials.password, "hasKey=" + !!credentials.privateKey);

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
    console.log("[OV:store] createTarget:", input.label, input.username + "@" + input.host + ":" + input.port);
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

  const deleteTarget = useCallback(async (targetId: string): Promise<void> => {
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
  }, [commit]);

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
    console.log("[OV:store] runConnectivityTest:", targetId, "forceReconnect=" + !!options?.forceReconnect);
    if (options?.forceReconnect) {
      await engineRef.current!.resetTargetSession(targetId);
    }

    console.log("[OV:store] runConnectivityTest: calling startRun...");
    const run = await startRun({
      targetId,
      type: "connectivity",
      command: "echo 'STEP 1/2: SSH connectivity check'; uname -a; echo 'STEP 2/2: SSH reachable'",
      timeoutSec: 20,
      fallbackPhase: "connect",
    });
    console.log("[OV:store] runConnectivityTest: run started", run.id, "status=" + run.status);

    const finalRun = await waitForTerminalRun(run.id);
    console.log("[OV:store] runConnectivityTest: final status=" + finalRun.status, "summary=" + (finalRun.summary ?? "none"));
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
    console.log("[OV:store] runCliDetection:", targetId);
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
      console.warn("[OV:store] runCliDetection: startRun failed:", msg);
      updateTargetStatus(targetId, "failed", msg);
      return {};
    }

    const finalRun = await waitForTerminalRun(run.id);
    const stdout = finalRun.rawLogs.filter((line) => line.stream === "stdout").map((line) => line.text).join("\n");
    const detectedTools = parseCliDetectionOutput(stdout);
    const daemonInfo = parseDaemonFromDetectionOutput(stdout);
    const daemonCompatibility = evaluateDaemonCompatibility(daemonInfo.installed, daemonInfo.version);
    console.log("[OV:store] runCliDetection raw stdout tail:", JSON.stringify(stdout.slice(-500)));

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

    console.log("[OV:store] runCliDetection complete:", JSON.stringify(detectedTools), "daemon:", JSON.stringify(daemonInfo));
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
    const linkedSessionIds = stateRef.current.sessions
      .filter((session) => session.workspaceId === workspaceId)
      .map((session) => session.id);

    for (const sessionId of linkedSessionIds) {
      await sessionEngineRef.current!.removeSession(sessionId);
    }

    commit((prev) => ({
      ...prev,
      workspaces: prev.workspaces.filter((workspace) => workspace.id !== workspaceId),
      sessions: prev.sessions.filter((session) => session.workspaceId !== workspaceId),
    }));
  }, [commit]);

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

      const hydratedStatus = workspaceChat.origin === "daemon"
        ? (workspaceChat.status === "running"
          ? "running"
          : workspaceChat.status === "failed"
            ? "failed"
            : workspaceChat.status === "cancelled"
              ? "cancelled"
              : "idle")
        : "idle";
      const hydrated = await sessionEngineRef.current!.hydrateSession(imported.id, {
        messages: parsed.messages,
        turns: parsed.turns,
        totalInputTokens: parsed.totalInputTokens,
        totalOutputTokens: parsed.totalOutputTokens,
        contextStatus: parsed.contextStatus,
        contextUsedTokens: parsed.contextUsedTokens,
        contextWindowTokens: parsed.contextWindowTokens,
        contextPercentUsed: parsed.contextPercentUsed,
        contextSource: parsed.contextSource,
        contextLabel: parsed.contextLabel,
        status: hydratedStatus,
        daemonOutputOffset: daemonHistoryLineCount,
      });
      if (hydrated) {
        imported = hydrated;
      }
    } catch (err) {
      console.warn("[OV:store] openWorkspaceChat history hydrate failed:", err);
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

  const installDaemon = useCallback(async (targetId: string): Promise<RunRecord> => {
    console.log("[OV:store] installDaemon:", targetId);
    const script = buildDaemonScript("install");
    const run = await startRun({
      targetId,
      type: "tool-action",
      command: script,
      timeoutSec: 120,
      fallbackPhase: "install",
    });

    const finalRun = await waitForTerminalRun(run.id);

    // Re-detect after install to update daemon status
    await runCliDetection(targetId);

    return finalRun;
  }, [startRun, waitForTerminalRun, runCliDetection]);

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
    console.log("[OV:store] createDraftSession:", input.tool, "target=" + input.targetId);
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
    console.log("[OV:store] createDraftSession: session created", session.id);
    return session;
  }, [touchWorkspace]);

  const startAiSession = useCallback(async (input: {
    targetId: string;
    tool: ToolName;
    prompt: string;
    workingDirectory?: string;
    allowedTools?: string[];
    model?: string;
  }): Promise<AiSession> => {
    console.log("[OV:store] startAiSession:", input.tool, "target=" + input.targetId, "prompt=" + input.prompt.slice(0, 80));
    const target = stateRef.current.targets.find((t) => t.id === input.targetId);
    if (!target) {
      console.error("[OV:store] startAiSession FAILED: target not found", input.targetId);
      throw new Error("Target not found");
    }
    assertDaemonCompatible(target);
    const credentials = await loadTargetCredentials(target.id);
    if (!credentials) {
      console.error("[OV:store] startAiSession FAILED: no credentials for", target.label);
      throw new Error("Target credentials are missing from secure store");
    }
    console.log("[OV:store] startAiSession: credentials loaded, calling SessionEngine.startSession");
    const session = await sessionEngineRef.current!.startSession({
      target,
      credentials,
      tool: input.tool,
      prompt: input.prompt,
      workingDirectory: input.workingDirectory,
      allowedTools: input.allowedTools,
      model: input.model,
      autoAccept: stateRef.current.autoAcceptTools,
    });
    console.log("[OV:store] startAiSession: session created", session.id, "status=" + session.status);
    return session;
  }, []);

  const sendAiPrompt = useCallback(async (sessionId: string, prompt: string): Promise<void> => {
    console.log("[OV:store] sendAiPrompt:", sessionId, "prompt=" + prompt.slice(0, 80));
    const session = stateRef.current.sessions.find((s) => s.id === sessionId);
    if (!session) {
      console.error("[OV:store] sendAiPrompt FAILED: session not found", sessionId);
      throw new Error("Session not found");
    }
    const target = stateRef.current.targets.find((t) => t.id === session.targetId);
    if (!target) {
      console.error("[OV:store] sendAiPrompt FAILED: target not found for session", sessionId);
      throw new Error("Target not found");
    }
    assertDaemonCompatible(target);
    const credentials = await loadTargetCredentials(target.id);
    if (!credentials) {
      console.error("[OV:store] sendAiPrompt FAILED: no credentials for target", target.label);
      throw new Error("Target credentials are missing from secure store");
    }
    console.log("[OV:store] sendAiPrompt: dispatching to SessionEngine");
    await sessionEngineRef.current!.sendPrompt(sessionId, { target, credentials, prompt, autoAccept: stateRef.current.autoAcceptTools });
    if (session.workspaceId) {
      touchWorkspace(session.workspaceId);
    }
    console.log("[OV:store] sendAiPrompt: completed");
  }, [touchWorkspace]);

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
    console.log("[OV:store] deleteSession:", sessionId);
    await sessionEngineRef.current!.removeSession(sessionId);
    commit((prev) => ({
      ...prev,
      sessions: prev.sessions.filter((s) => s.id !== sessionId),
    }));
  }, [commit]);

  const clearSessions = useCallback(async (): Promise<void> => {
    commit((prev) => ({ ...prev, sessions: [] }));
  }, [commit]);

  const updateSessionModel = useCallback((sessionId: string, model: string): void => {
    sessionEngineRef.current!.updateModel(sessionId, model);
    commit((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) =>
        s.id === sessionId ? { ...s, model, updatedAt: new Date().toISOString() } : s,
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
            status: "idle",
            updatedAt: new Date().toISOString(),
          }
          : s,
      ),
    }));
  }, [commit]);

  const importDaemonSessions = useCallback(async (targetId: string): Promise<AiSession[]> => {
    console.log("[OV:store] importDaemonSessions:", targetId);
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

    console.log("[OV:store] importDaemonSessions: found", daemonSessions.length, "total,", importable.length, "importable");

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

    console.log("[OV:store] importDaemonSessions: imported", imported.length, "sessions");
    return imported;
  }, []);

  const setAutoAcceptTools = useCallback((value: boolean): void => {
    commit((prev) => ({ ...prev, autoAcceptTools: value }));
  }, [commit]);

  const setNotificationsEnabled = useCallback((value: boolean): void => {
    sessionEngineRef.current!.notificationsEnabled = value;
    commit((prev) => ({ ...prev, notificationsEnabled: value }));
  }, [commit]);

  const setSpeechLanguage = useCallback((value: string): void => {
    commit((prev) => ({ ...prev, speechLanguage: value }));
  }, [commit]);

  // Merge built-in prompts with user templates
  const promptTemplates = useMemo(() => {
    const userTemplates = state.promptTemplates.filter((t) => !t.isBuiltIn);
    const merged = [...BUILT_IN_PROMPTS, ...userTemplates];
    return merged.sort((a, b) => a.sortOrder - b.sortOrder);
  }, [state.promptTemplates]);

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
    compactSessionMessages,
    clearSessionMessages,
    importDaemonSessions,
    autoAcceptTools: state.autoAcceptTools ?? false,
    setAutoAcceptTools,
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
  }), [
    ready,
    state.targets,
    state.runs,
    state.workspaces,
    state.sessions,
    state.readinessByTarget,
    state.autoAcceptTools,
    state.notificationsEnabled,
    state.speechLanguage,
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
    compactSessionMessages,
    clearSessionMessages,
    importDaemonSessions,
    setAutoAcceptTools,
    setNotificationsEnabled,
    addPromptTemplate,
    updatePromptTemplate,
    deletePromptTemplate,
    reorderPromptTemplates,
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
