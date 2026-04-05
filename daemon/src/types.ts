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

// ── Settings ──

export interface DaemonSettings {
  language: string;
  voiceLang: string;
  showToolDetails: boolean;
  pollInterval: number;
  showHiddenFiles: boolean;
  sttProvider: "soniox";
  sttApiKey: string;
}

// ── Prompts ──

export interface PromptRecord {
  id: string;
  label: string;
  prompt: string;
  isBuiltIn: boolean;
}

// ── Diffs ──

export interface DiffFileRecord {
  path: string;
  added: number;
  removed: number;
  isNew: boolean;
}

// ── Ports ──

export interface PortEntryRecord {
  port: number;
  process: string;
  pid: number;
  address: string;
}

// ── Teams ──

export interface TeamMember {
  name: string;
  tool: Tool;
  role: 'lead' | 'coder' | 'reviewer' | 'planner';
  sessionId?: string;
}

export interface TeamRecord {
  id: string;
  name: string;
  members: TeamMember[];
  workingDirectory?: string;
  createdAt: string;
}

export interface TeamTaskRecord {
  id: string;
  teamId: string;
  subject: string;
  description?: string;
  owner?: string;
  ownerTool?: string;
  status: string;
  createdAt: string;
}

export interface TeamMessageRecord {
  from: string;
  fromTool?: string;
  to: string;
  text: string;
  createdAt: string;
  sessionId?: string;
}

// ── Schedules ──

export interface ScheduleRecord {
  id: string;
  name: string;
  schedule: string;
  project?: string;
  lastRun?: string;
  lastStatus?: string;
}

export interface DaemonState {
  version: 1;
  sessions: Record<string, SessionRecord>;
  pushToken?: string;
  settings?: DaemonSettings;
  prompts?: PromptRecord[];
  teams?: TeamRecord[];
  teamTasks?: TeamTaskRecord[];
  teamMessages?: TeamMessageRecord[];
  schedules?: ScheduleRecord[];
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

// ── File System ──

export interface FsEntry {
  name: string;
  type: 'file' | 'dir';
  size: number;
  modifiedAt: string;
}

export interface FsReadResult {
  content: string;
  totalLines: number;
  truncated: boolean;
}

export interface FsStatResult {
  name: string;
  type: 'file' | 'dir';
  size: number;
  modifiedAt: string;
  permissions: string;
}

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
  models?: Array<{
    id: string;
    displayName: string;
    hidden: boolean;
    isDefault: boolean;
  }>;
  history?: SessionHistoryPayload;
  entries?: FsEntry[];
  fileContent?: FsReadResult;
  stat?: FsStatResult;
  timedOut?: boolean;
  pid?: number;
  activeSessions?: number;
  totalSessions?: number;
  // Settings
  settings?: DaemonSettings;
  // Prompts
  prompts?: PromptRecord[];
  prompt?: PromptRecord;
  // Diffs
  files?: DiffFileRecord[];
  // Ports
  ports?: PortEntryRecord[];
  // Diff file content
  content?: string;
  // Bridge QR
  url?: string;
  // Teams
  teams?: Array<{
    id: string;
    name: string;
    members: TeamMember[];
    workingDirectory?: string;
    createdAt: string;
    memberCount: number;
    taskCount: number;
    activeCount: number;
    tasksDone: number;
    tasksTotal: number;
  }>;
  team?: TeamRecord;
  teamTasks?: TeamTaskRecord[];
  teamMessages?: TeamMessageRecord[];
  task?: TeamTaskRecord;
  // Schedules
  schedules?: ScheduleRecord[];
  schedule?: ScheduleRecord;
}

// ── Normalized Events & Snapshots ──

export interface NormalizedCliEvent {
  type: "message_start" | "content_block" | "usage" | "error" | "message_complete";
  role?: "system" | "assistant" | "user";
  block?: SnapshotContentBlock;
  inputTokens?: number;
  outputTokens?: number;
  contextUsedTokens?: number;
  contextWindowTokens?: number;
  contextSource?: "provider" | "derived";
  conversationId?: string;
}

export type SnapshotContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; toolName: string; toolId?: string; toolInput?: unknown }
  | { type: "tool_result"; toolId?: string; result: string; isError?: boolean }
  | { type: "usage"; inputTokens?: number; outputTokens?: number }
  | { type: "error"; text: string };

export interface SessionSnapshotMessage {
  role: "user" | "assistant";
  content: SnapshotContentBlock[];
  timestamp: string;
  turnIndex: number;
  isStreaming: boolean;
}

export interface SessionSnapshotTurn {
  index: number;
  userPrompt: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
}

export interface SessionSnapshot {
  schemaVersion: 1;
  tool: Tool;
  lastEventSeq: number;
  messages: SessionSnapshotMessage[];
  turns: SessionSnapshotTurn[];
  totalInputTokens: number;
  totalOutputTokens: number;
  contextStatus: "ok" | "unavailable";
  contextLabel?: string;
  contextUsedTokens?: number;
  contextWindowTokens?: number;
  contextPercentUsed?: number;
  contextSource?: "provider" | "derived";
}

export interface SessionEventRecord {
  seq: number;
  ts: number;
  kind: "turn_start" | "turn_end" | "cli_event";
  turnIndex: number;
  prompt?: string;
  exitCode?: number;
  cliEvent?: NormalizedCliEvent;
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
