import type { NativeSessionRecord, SessionRecord, WorkspaceSessionRecord } from "../types.js";
import { listClaudeNativeSessions } from "./claude.js";
import { listCodexLegacySessions, listCodexNativeSessions } from "./codex.js";
import { normalizeWorkspacePath, sortByUpdatedDesc } from "./pathUtils.js";
import type { ListNativeSessionsOptions, MergeWorkspaceSessionsInput, MergeWorkspaceSessionsOutput } from "./types.js";

function workspaceDedupKey(input: {
  tool: "claude" | "codex";
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
    tool: session.tool as "claude" | "codex",
    status: session.status,
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

export function mergeWorkspaceSessions(input: MergeWorkspaceSessionsInput): MergeWorkspaceSessionsOutput {
  const targetCwd = normalizeWorkspacePath(input.cwd);
  const out = new Map<string, WorkspaceSessionRecord>();

  for (const daemonSession of input.daemonSessions) {
    if (daemonSession.tool !== "claude" && daemonSession.tool !== "codex") continue;
    if (normalizeWorkspacePath(daemonSession.workingDirectory) !== targetCwd) continue;

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
    if (nativeSession.tool !== "claude" && nativeSession.tool !== "codex") continue;
    if (normalizeWorkspacePath(nativeSession.workingDirectory) !== targetCwd) continue;

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

    // Prefer native title (firstPrompt — matches `claude -r` / `codex` display)
    // over daemon title (which is lastTurn.prompt — the most recent turn, not the session name).
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
    // Use the most recent updatedAt between daemon and native so that sessions
    // active outside the app (e.g. direct CLI usage) sort to the top.
    if (nativeRecord.updatedAt && (!existing.updatedAt || nativeRecord.updatedAt > existing.updatedAt)) {
      existing.updatedAt = nativeRecord.updatedAt;
    }
  }

  return sortByUpdatedDesc([...out.values()]);
}
