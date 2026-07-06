// ── Session & State ──

export type Tool = "claude" | "codex" | "gemini";
export type SessionExecutionBackend = "cli" | "codex_app_server";

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

export interface PromptRecord {
  id: string;
  label: string;
  prompt: string;
  isBuiltIn: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface FollowUpSuggestion {
  id: string;
  label: string;
  prompt: string;
  source: "ai" | "heuristic";
}

export interface SessionRecord {
  id: string;
  tool: Tool;
  status: SessionStatus;
  executionBackend?: SessionExecutionBackend;
  runKind?: "interactive" | "scheduled" | "team";
  scheduleId?: string;
  scheduleName?: string;
  teamId?: string;
  teamName?: string;
  workflowTaskId?: string;
  workflowTaskTitle?: string;
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
  tool: Tool;
  status: SessionStatus;
  runKind?: "interactive" | "scheduled" | "team";
  scheduleId?: string;
  scheduleName?: string;
  teamId?: string;
  teamName?: string;
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

export interface BridgeConfig {
  enabled: boolean;
  port: number;
  tls: boolean;
  bindHost?: string;              // bind interface for the embedded bridge (default: ::)
  secretKey: string;              // hex-encoded 32-byte HMAC secret
  revokedTokens: string[];        // revoked JTI strings
  clientSessions?: Record<string, BridgeClientSession>;
  defaultCwd?: string;            // working dir for Even AI sessions (default: $HOME)
  evenAiTool?: "claude" | "codex" | "gemini";  // tool for Even AI (default: "claude")
  evenAiMode?: "new" | "last" | "pinned";  // session routing mode (default: "last")
  evenAiPinnedSessionId?: string;  // session ID for pinned mode
  currentEvenAiSessionId?: string; // last-used session ID (for "last" mode)
}

export interface BridgeConfigSnapshot {
  enabled: boolean;
  port: number;
  tls: boolean;
  bindHost: string;
  defaultCwd: string;
  evenAiTool: "claude" | "codex" | "gemini";
  evenAiMode: "new" | "last" | "pinned";
  evenAiPinnedSessionId: string;
  currentEvenAiSessionId: string;
}

export interface BridgeClientSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  refreshExpiresAt: string;
  refreshTokenHash: string;
  userAgent?: string;
  lastSeenAt?: string;
  lastIp?: string;
}

export interface DaemonState {
  version: 1;
  sessions: Record<string, SessionRecord>;
  prompts?: PromptRecord[];
  pushToken?: string;
  bridge?: BridgeConfig;
  teams?: Record<string, TeamConfig>;
  schedules?: Record<string, ScheduledTask>;
  workflowConfig?: WorkflowConfig;
  workflowProjects?: Record<string, WorkflowProject>;
  workflowTasks?: Record<string, WorkflowTask>;
  workflowDecisions?: Record<string, WorkflowDecision>;
  workflowBriefings?: Record<string, WorkflowBriefing>;
  workflowEvents?: WorkflowEvent[];
  /** IDs of native sessions (e.g. "codex:abc123", "claude:xyz") that the user has dismissed from the list. */
  dismissedNativeIds?: string[];
}

// ── Workflow Control Plane ──

export type WorkflowPriority = "low" | "medium" | "high";
export type WorkflowTaskStatus =
  | "draft"
  | "ready"
  | "running"
  | "blocked"
  | "needs-review"
  | "done";

export type WorkflowTaskSource = "manual" | "github" | "notion" | "briefing" | "session";
export type WorkflowExternalProvider = "github" | "notion";
export type WorkflowExternalKind = "issue" | "pull-request" | "task" | "briefing" | "session" | "decision";
export type WorkflowSyncStatus = "pending" | "synced" | "failed";

export interface WorkflowProject {
  id: string;
  name: string;
  path: string;
  github?: string;
  priority: WorkflowPriority;
  type?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowExternalLink {
  provider: WorkflowExternalProvider;
  kind: WorkflowExternalKind;
  id?: string;
  number?: number;
  url?: string;
  status: WorkflowSyncStatus;
  error?: string;
  updatedAt: string;
}

export interface WorkflowTask {
  id: string;
  title: string;
  goal: string;
  context?: string;
  projectId?: string;
  repoPath?: string;
  githubRepo?: string;
  status: WorkflowTaskStatus;
  source: WorkflowTaskSource;
  tool: Tool;
  sessionIds: string[];
  externalLinks: WorkflowExternalLink[];
  acceptanceCriteria: string[];
  outOfScope: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  summary?: string;
}

export interface WorkflowBriefing {
  id: string;
  date: string;
  title: string;
  markdown: string;
  path?: string;
  externalLinks: WorkflowExternalLink[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowDecision {
  id: string;
  projectId?: string;
  projectName?: string;
  text: string;
  externalLinks: WorkflowExternalLink[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowEvent {
  id: string;
  type: string;
  entityType: "project" | "task" | "briefing" | "decision" | "session" | "integration";
  entityId: string;
  message: string;
  createdAt: string;
}

export interface WorkflowConfig {
  workspaceRoot?: string;
  github?: {
    enabled?: boolean;
    defaultOwner?: string;
    autoCreateIssues?: boolean;
  };
  notion?: {
    enabled?: boolean;
    tasksDatabaseId?: string;
    briefingsDatabaseId?: string;
    decisionsDatabaseId?: string;
    sessionsDatabaseId?: string;
  };
}

export interface WorkflowPullRequestDraft {
  title: string;
  body: string;
  base: string;
  draft: boolean;
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

export interface PromptScheduleTarget {
  kind: "prompt";
  tool: Tool;
  cwd: string;
  prompt: string;
  model?: string;
  mode?: string;
}

export interface TeamScheduleTarget {
  kind: "team";
  teamId: string;
  prompt: string;
  to?: string;
}

export type ScheduleTarget = PromptScheduleTarget | TeamScheduleTarget;

export interface ScheduledTask {
  id: string;
  name: string;
  schedule: string;
  project?: string;
  enabled: boolean;
  target: ScheduleTarget;
  createdAt: string;
  updatedAt: string;
  lastRun?: string;
  lastStatus?: "idle" | "running" | "success" | "failed";
  lastError?: string;
  nextRun?: string;
  lastSessionId?: string;
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
  entries?: Array<{ name: string; type: string; size: number; modifiedAt: string }>;
  fileContent?: { content: string };
  remoteUrl?: string;
  schedules?: ScheduledTask[];
  schedule?: ScheduledTask;
  prompt?: PromptRecord;
  prompts?: PromptRecord[];
  suggestions?: FollowUpSuggestion[];
  suggestionSource?: "ai" | "heuristic";
  suggestionsCached?: boolean;
  team?: TeamConfig;
  teams?: TeamConfig[];
  teamTasks?: TeamTask[];
  teamTask?: TeamTask;
  teamMessages?: TeamMessage[];
  teamPlan?: TeamPlan;
  timedOut?: boolean;
  pid?: number;
  name?: string;
  activeSessions?: number;
  totalSessions?: number;
  tools?: Record<string, boolean>;
  bridgeUrl?: string;
  bridgeToken?: string;
  bridgeStatus?: { enabled: boolean; port: number; tls: boolean; bindHost: string; connections: number };
  bridgeConfig?: BridgeConfigSnapshot;
  qrLines?: string[];
  workflowConfig?: WorkflowConfig;
  workflowProjects?: WorkflowProject[];
  workflowProject?: WorkflowProject;
  workflowTasks?: WorkflowTask[];
  workflowTask?: WorkflowTask;
  workflowDecision?: WorkflowDecision;
  workflowDecisions?: WorkflowDecision[];
  workflowBriefing?: WorkflowBriefing;
  workflowBriefings?: WorkflowBriefing[];
  workflowEvents?: WorkflowEvent[];
  workflowPrompt?: string;
  pullRequest?: WorkflowPullRequestDraft;
  syncResults?: Array<{ target: string; ok: boolean; message?: string; error?: string }>;
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

// ── Agent Teams ──

export type AgentRole = "lead" | "coder" | "reviewer" | "planner";

export interface TeamMember {
  name: string;
  tool: Tool;
  model?: string;
  role: AgentRole;
  sessionId: string;
}

export type TaskStatus = "todo" | "in_progress" | "done" | "review" | "approved";

export interface TeamTask {
  id: string;
  teamId: string;
  subject: string;
  description: string;
  owner: string;
  status: TaskStatus;
  dependencies: string[];
  blockedBy: string[];
  comments: TaskComment[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskComment {
  id: string;
  author: string;
  text: string;
  createdAt: string;
}

export interface TeamMessage {
  id: string;
  teamId: string;
  from: string;
  fromTool?: Tool;
  to: string;
  text: string;
  createdAt: string;
}

export interface TeamConfig {
  id: string;
  name: string;
  workingDirectory: string;
  members: TeamMember[];
  taskCount?: number;
  tasksTotal?: number;
  tasksDone?: number;
  activeCount?: number;
  latestPlanId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlanRevision {
  id: string;
  author: string;
  tasks: { subject: string; description: string; owner: string; dependencies?: string[] }[];
  feedback?: string;
  createdAt: string;
}

export interface PlanReviewVote {
  reviewer: string;
  vote: "approve" | "revise" | "reject";
  feedback?: string;
  iteration: number;
  createdAt: string;
}

export type PlanMode = "simple" | "consensus";

export interface TeamPlan {
  id: string;
  teamId: string;
  revisions: PlanRevision[];
  votes: PlanReviewVote[];
  status: "draft" | "review" | "revision" | "approved" | "rejected" | "auto-approved";
  mode: PlanMode;
  createdBy: string;
  reviewers: string[];
  currentReviewer?: string;
  iteration: number;
  maxIterations: number;
  createdAt: string;
  updatedAt: string;
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
