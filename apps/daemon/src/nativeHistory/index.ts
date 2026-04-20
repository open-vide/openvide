import type { NativeSessionRecord, SessionRecord, Tool, WorkspaceSessionRecord } from "../types.js";
import { listClaudeNativeSessions } from "./claude.js";
import { listCodexLegacySessions, listCodexNativeSessions } from "./codex.js";
import { normalizeWorkspacePath, sortByUpdatedDesc } from "./pathUtils.js";
import { listDismissedNativeIds } from "../sessionManager.js";
import type { ListNativeSessionsOptions, MergeWorkspaceSessionsInput, MergeWorkspaceSessionsOutput } from "./types.js";

const NATIVE_CATALOG_CACHE_TTL_MS = 10000;

let nativeCatalogCache:
  | {
    tool: "claude" | "codex" | "all";
    expiresAt: number;
    sessions: NativeSessionRecord[];
  }
  | null = null;

function workspaceDedupKey(input: {
  tool: Tool;
  origin: "daemon" | "native";
  resumeId: string;
  daemonSessionId?: string;
}): string {
  if (input.resumeId) {
    return `${input.tool}:resume:${input.resumeId}`;
  }
  if (input.origin === "daemon" && input.daemonSessionId) {
    return `daemon:${input.daemonSessionId}`;
  }
  return `${input.origin}:${input.tool}:unknown`;
}

function daemonToWorkspaceRecord(session: SessionRecord): WorkspaceSessionRecord {
  return {
    id: session.id,
    origin: "daemon",
    tool: session.tool,
    status: session.status,
    runKind: session.runKind,
    scheduleId: session.scheduleId,
    scheduleName: session.scheduleName,
    teamId: session.teamId,
    teamName: session.teamName,
    workingDirectory: session.workingDirectory,
    resumeId: session.conversationId ?? session.id,
    conversationId: session.conversationId,
    daemonSessionId: session.id,
    model: session.model,
    outputLines: session.outputLines,
    outputBytes: session.outputBytes,
    pid: session.pid,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    title: session.lastTurn?.prompt?.trim() || undefined,
    pendingPermission: session.pendingPermission,
    lastTurn: session.lastTurn,
  };
}

function nativeToWorkspaceRecord(session: NativeSessionRecord): WorkspaceSessionRecord {
  return {
    id: session.id,
    origin: "native",
    tool: session.tool,
    status: "idle",
    workingDirectory: session.workingDirectory,
    resumeId: session.nativeSessionId,
    conversationId: session.nativeSessionId,
    outputLines: 0,
    outputBytes: 0,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    title: session.title,
    summary: session.summary,
    messageCount: session.messageCount,
  };
}

export async function listNativeSessionsForWorkspace(
  options: ListNativeSessionsOptions,
): Promise<NativeSessionRecord[]> {
  if (!options.cwd) {
    return [];
  }
  const tool = options.tool ?? "all";
  const tasks: Array<Promise<NativeSessionRecord[]>> = [];
  if (tool === "all" || tool === "claude") {
    tasks.push(listClaudeNativeSessions(options.cwd));
  }
  if (tool === "all" || tool === "codex") {
    tasks.push(listCodexNativeSessions(options.cwd));
    tasks.push(listCodexLegacySessions());
  }
  const settled = await Promise.all(tasks);
  return sortByUpdatedDesc(settled.flat());
}

export async function listNativeSessionsCatalog(
  options: Pick<ListNativeSessionsOptions, "tool"> = {},
): Promise<NativeSessionRecord[]> {
  const tool = options.tool ?? "all";
  const now = Date.now();
  if (nativeCatalogCache && nativeCatalogCache.tool === tool && nativeCatalogCache.expiresAt > now) {
    return nativeCatalogCache.sessions;
  }

  const tasks: Array<Promise<NativeSessionRecord[]>> = [];
  if (tool === "all" || tool === "claude") {
    tasks.push(listClaudeNativeSessions());
  }
  if (tool === "all" || tool === "codex") {
    tasks.push(listCodexNativeSessions());
    tasks.push(listCodexLegacySessions());
  }

  const sessions = sortByUpdatedDesc((await Promise.all(tasks)).flat());
  nativeCatalogCache = {
    tool,
    expiresAt: now + NATIVE_CATALOG_CACHE_TTL_MS,
    sessions,
  };
  return sessions;
}

function mergeSessionCollections(input: {
  daemonSessions: SessionRecord[];
  nativeSessions: NativeSessionRecord[];
  cwd?: string;
}): WorkspaceSessionRecord[] {
  const targetCwd = input.cwd ? normalizeWorkspacePath(input.cwd) : null;
  const dismissed = new Set(listDismissedNativeIds());
  const out = new Map<string, WorkspaceSessionRecord>();

  for (const daemonSession of input.daemonSessions) {
    if (targetCwd && normalizeWorkspacePath(daemonSession.workingDirectory) !== targetCwd) continue;

    const record = daemonToWorkspaceRecord(daemonSession);
    const key = workspaceDedupKey({
      tool: record.tool,
      origin: record.origin,
      resumeId: record.resumeId,
      daemonSessionId: record.daemonSessionId,
    });
    out.set(key, record);
  }

  for (const nativeSession of input.nativeSessions) {
    if (targetCwd && normalizeWorkspacePath(nativeSession.workingDirectory) !== targetCwd) continue;
    if (dismissed.has(nativeSession.id)) continue;

    const nativeRecord = nativeToWorkspaceRecord(nativeSession);
    const key = workspaceDedupKey({
      tool: nativeRecord.tool,
      origin: nativeRecord.origin,
      resumeId: nativeRecord.resumeId,
    });

    const existing = out.get(key);
    if (!existing) {
      out.set(key, nativeRecord);
      continue;
    }

    if (nativeRecord.title) {
      existing.title = nativeRecord.title;
    }
    if (!existing.summary && nativeRecord.summary) {
      existing.summary = nativeRecord.summary;
    }
    if (!existing.messageCount && nativeRecord.messageCount) {
      existing.messageCount = nativeRecord.messageCount;
    }
    if (!existing.createdAt && nativeRecord.createdAt) {
      existing.createdAt = nativeRecord.createdAt;
    }
    if (nativeRecord.updatedAt && (!existing.updatedAt || nativeRecord.updatedAt > existing.updatedAt)) {
      existing.updatedAt = nativeRecord.updatedAt;
    }
  }

  return sortByUpdatedDesc([...out.values()]);
}

export function mergeWorkspaceSessions(input: MergeWorkspaceSessionsInput): MergeWorkspaceSessionsOutput {
  return mergeSessionCollections(input);
}

export function mergeDiscoveredSessions(input: {
  daemonSessions: SessionRecord[];
  nativeSessions: NativeSessionRecord[];
}): WorkspaceSessionRecord[] {
  return mergeSessionCollections(input);
}
