import type { NativeSessionRecord, SessionRecord, WorkspaceSessionRecord } from "../types.js";

export interface ListNativeSessionsOptions {
  cwd?: string;
  tool?: "claude" | "codex" | "all";
}

export interface NativeHistoryAdapter {
  tool: "claude" | "codex";
  listByWorkspace: (cwd: string) => Promise<NativeSessionRecord[]>;
}

export type MergeWorkspaceSessionsInput = {
  cwd: string;
  daemonSessions: SessionRecord[];
  nativeSessions: NativeSessionRecord[];
};

export type MergeWorkspaceSessionsOutput = WorkspaceSessionRecord[];
