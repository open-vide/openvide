// ── Session & State ──

export type Tool = "claude" | "codex" | "gemini";

export type SessionStatus =
  | "idle"
  | "running"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface LastTurn {
  prompt: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  error?: string;
}

export interface SessionRecord {
  id: string;
  tool: Tool;
  status: SessionStatus;
  pendingRemoval?: boolean;
  conversationId?: string;
  workingDirectory: string;
  model?: string;
  autoAccept?: boolean;
  createdAt: string;
  updatedAt: string;
  lastTurn?: LastTurn;
  outputLines: number;
  outputBytes: number;
  pid?: number;
}

export interface SessionHistoryPayload {
  source: "daemon" | "native";
  tool: "claude" | "codex" | "gemini";
  format: "daemon_output_jsonl" | "native_claude_jsonl" | "native_codex_jsonl";
  lines: string[];
  lineCount: number;
  truncated: boolean;
}

export interface NativeSessionRecord {
  id: string;
  tool: "claude" | "codex";
  nativeSessionId: string;
  workingDirectory: string;
  createdAt?: string;
  updatedAt?: string;
  title?: string;
  summary?: string;
  messageCount?: number;
  source: "native";
}

export interface WorkspaceSessionRecord {
  id: string;
  origin: "daemon" | "native";
  tool: "claude" | "codex";
  status: SessionStatus;
  workingDirectory: string;
  resumeId: string;
  conversationId?: string;
  daemonSessionId?: string;
  model?: string;
  outputLines: number;
  outputBytes: number;
  pid?: number;
  createdAt?: string;
  updatedAt?: string;
  title?: string;
  summary?: string;
  messageCount?: number;
  lastTurn?: LastTurn;
}

export interface DaemonState {
  version: 1;
  sessions: Record<string, SessionRecord>;
}

// ── Output JSONL ──

export interface OutputLineStdout {
  t: "o";
  ts: number;
  line: string;
}

export interface OutputLineStderr {
  t: "e";
  ts: number;
  line: string;
}

export interface OutputLineMeta {
  t: "m";
  ts: number;
  event: "turn_start" | "turn_end" | "error";
  prompt?: string;
  exitCode?: number;
  error?: string;
}

export type OutputLine = OutputLineStdout | OutputLineStderr | OutputLineMeta;

// ── IPC ──

export interface IpcRequest {
  cmd: string;
  [key: string]: unknown;
}

export interface IpcResponse {
  ok: boolean;
  error?: string;
  session?: SessionRecord;
  sessions?: Array<SessionRecord | NativeSessionRecord | WorkspaceSessionRecord>;
  history?: SessionHistoryPayload;
  timedOut?: boolean;
  pid?: number;
  activeSessions?: number;
  totalSessions?: number;
}

// ── Command Builder ──

export interface BuildCommandOpts {
  prompt: string;
  conversationId?: string;
  model?: string;
  mode?: string;
  autoAccept?: boolean;
  messages?: { role: string; text: string }[];
}
