export type AuthMethod = "password" | "privateKey" | "privateKeyPassphrase";

export type ToolName = "claude" | "codex" | "gemini";

export type ToolAction =
  | "install"
  | "update"
  | "verify"
  | "uninstall";

export type RunType = "command" | "tool-action" | "connectivity" | "readiness";

export type RunStatus =
  | "connecting"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout";

export type RunPhase =
  | "connect"
  | "precheck"
  | "install"
  | "configure"
  | "verify"
  | "complete"
  | "failed";

export type EventSeverity = "info" | "warning" | "error" | "success" | "prompt";

export interface TargetProfile {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  tags: string[];
  authMethod: AuthMethod;
  lastStatus: "unknown" | "connected" | "failed";
  lastStatusReason?: string;
  lastSeenAt?: string;
  detectedTools?: DetectedToolsMap;
  detectedToolsScannedAt?: string;
  daemonInstalled?: boolean;
  daemonVersion?: string;
  daemonCompatible?: boolean;
  daemonRequiredVersion?: string;
  daemonCompatibilityReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReadinessReport {
  targetId: string;
  scannedAt: string;
  os: string;
  distro: string;
  distroVersion: string;
  arch: string;
  shell: string;
  packageManager: string;
  toolchain: Record<string, boolean>;
  prerequisites: {
    node: boolean;
    npm: boolean;
    curl: boolean;
    git: boolean;
  };
  readiness: "ready" | "partial" | "blocked";
  notes: string[];
}

export interface ProgressMarker {
  current: number;
  total: number;
  label: string;
}

export interface ParsedEvent {
  seq: number;
  timestamp: string;
  phase: RunPhase;
  severity: EventSeverity;
  message: string;
  rawLineIds: number[];
  progress?: ProgressMarker;
  metadata?: Record<string, string | number | boolean | null>;
  nextActions?: string[];
}

export interface RawLogLine {
  id: number;
  seq: number;
  timestamp: string;
  stream: "stdout" | "stderr" | "system";
  text: string;
}

export interface RunRecord {
  id: string;
  targetId: string;
  type: RunType;
  status: RunStatus;
  tool?: ToolName;
  action?: ToolAction;
  command: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  exitCode?: number;
  summary?: string;
  nextActions: string[];
  events: ParsedEvent[];
  rawLogs: RawLogLine[];
}

export interface SshCredentials {
  password?: string;
  privateKey?: string;
  privateKeyPassphrase?: string;
}

export interface DetectedToolInfo {
  installed: boolean;
  version?: string;
  path?: string;
}

export type DetectedToolsMap = Partial<Record<ToolName, DetectedToolInfo>>;

/* ── AI session types ── */

export type AiSessionStatus =
  | "idle"
  | "running"
  | "awaiting_input"
  | "completed"
  | "failed"
  | "cancelled";

export type AiContentBlockType =
  | "text"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "file_change"
  | "command_exec"
  | "error"
  | "usage"
  | "web_search";

export interface AiContentBlock {
  type: AiContentBlockType;
  text?: string;
  toolName?: string;
  toolInput?: unknown;
  toolId?: string;
  result?: string;
  isError?: boolean;
  filePath?: string;
  diff?: string;
  command?: string;
  exitCode?: number;
  output?: string;
  inputTokens?: number;
  outputTokens?: number;
  // web_search
  searchQuery?: string;
  searchResults?: Array<{ title: string; url: string; snippet: string }>;
  // tool status tracking
  toolStatus?: "running" | "completed" | "error";
  activityText?: string;
  durationMs?: number;
}

export interface AiMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: AiContentBlock[];
  timestamp: string;
  turnIndex: number;
  isStreaming?: boolean;
}

export interface AiTurn {
  index: number;
  userPrompt: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  error?: string;
}

export interface AiSession {
  id: string;
  targetId: string;
  workspaceId?: string;
  tool: ToolName;
  status: AiSessionStatus;
  messages: AiMessage[];
  turns: AiTurn[];
  conversationId?: string;
  workingDirectory?: string;
  model?: string;
  showToolDetails?: boolean;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  contextStatus?: "ok" | "unavailable";
  contextUsedTokens?: number;
  contextWindowTokens?: number;
  contextPercentUsed?: number;
  contextSource?: "provider" | "derived";
  contextLabel?: string;
  daemonSessionId?: string;
  daemonOutputOffset?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  targetId: string;
  directory: string;
  createdAt: string;
  updatedAt: string;
}

/* ── Prompt template types ── */

export interface PromptTemplate {
  id: string;
  label: string;
  prompt: string;
  icon?: string;
  category: "general" | "debug" | "review" | "refactor" | "test" | "custom";
  toolFilter?: ToolName[];
  statusFilter?: AiSessionStatus[];
  isBuiltIn: boolean;
  sortOrder: number;
}

export interface PromptFlow {
  id: string;
  label: string;
  description?: string;
  steps: PromptFlowStep[];
  isBuiltIn: boolean;
}

export interface PromptFlowStep {
  promptTemplateId: string;
  delayMs?: number;
  condition?: "always" | "on_success" | "on_failure";
}

/* ── Persisted state ── */

export interface PersistedState {
  version?: number;
  targets: TargetProfile[];
  runs: RunRecord[];
  readinessByTarget: Record<string, ReadinessReport>;
  workspaces: Workspace[];
  sessions: AiSession[];
  promptTemplates: PromptTemplate[];
  promptFlows: PromptFlow[];
  hiddenBuiltInPromptIds: string[];
  showToolDetails: boolean;
  notificationsEnabled: boolean;
  speechLanguage: string;
}
