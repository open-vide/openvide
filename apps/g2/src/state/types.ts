// ── Host Types ──

import type { PendingPermissionRequest } from '../types';

export interface Host {
  id: string;
  name: string;
  url: string;             // bridge URL, e.g. http://localhost:7842 or https://remote:7842
  token?: string;          // pairing/bootstrap token for remote bridges
  accessToken?: string;    // short-lived rotating bridge access token
  refreshToken?: string;   // long-lived rotating refresh token
  authSessionId?: string;  // bridge auth session identifier
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
}

// ── Workspace Types ──

export interface Workspace {
  path: string;            // absolute path on host
  hostId?: string;         // which host this workspace belongs to
  name: string;            // display name (last dir component)
  sessionCount: number;
  runningCount: number;
}

// ── Session Types ──

export type Tool = 'claude' | 'codex' | 'gemini';

export type SessionStatus = 'idle' | 'running' | 'awaiting_approval' | 'failed' | 'cancelled' | 'interrupted';

export interface SessionSummary {
  id: string;
  hostId?: string;
  tool: Tool;
  status: SessionStatus;
  workingDirectory: string;
  model?: string;
  lastPrompt?: string;
  lastError?: string;
  updatedAt: string;
  outputLines: number;
  origin?: 'daemon' | 'native';
  resumeId?: string;
  title?: string;
  summary?: string;
  messageCount?: number;
  pendingPermission?: PendingPermissionRequest;
}

// ── File Browser Types ──

export interface FsEntry {
  name: string;
  type: 'file' | 'dir';
  size: number;
  modifiedAt: string;
}

// ── Action Result ──

export interface ActionResult {
  action: string;
  sessionId: string;
  success: boolean;
  message: string;
}

// ── Diff Types (Phase 4) ──

export interface DiffFile {
  path: string;
  added: number;
  removed: number;
  isNew: boolean;
}

// ── Settings Types (Phase 5) ──

import type { AppLanguage } from '../utils/i18n';

export interface Settings {
  language: AppLanguage;       // UI language, default 'en'
  voiceLang: string;         // BCP-47 code, default 'en-US'
  showToolDetails: boolean;  // default true
  pollInterval: number;      // ms, default 2500
  showHiddenFiles: boolean;  // default false
  codexPermissionMode: 'auto' | 'ask';
  sttProvider: 'soniox';
  sttApiKey: string;
}

// ── Prompt Types (Phase 6) ──

export interface Prompt {
  id: string;
  label: string;
  prompt: string;
  isBuiltIn: boolean;
}

export interface SuggestedPrompt {
  id: string;
  label: string;
  prompt: string;
  source: 'ai' | 'heuristic';
}

// ── Port Types (Phase 7) ──

export interface PortEntry {
  port: number;
  process: string;
  pid: number;
  address: string;
}

// ── Schedule Types ──

export interface ScheduledTask {
  id: string;
  name: string;
  schedule: string;
  project?: string;
  enabled?: boolean;
  target?: {
    kind: 'prompt' | 'team';
    tool?: Tool;
    cwd?: string;
    prompt?: string;
    teamId?: string;
    to?: string;
  };
  createdAt?: string;
  updatedAt?: string;
  lastRun?: string;
  lastStatus?: string;
  lastError?: string;
  nextRun?: string;
  lastSessionId?: string;
}

// ── Team Types ──

export interface TeamSummary {
  id: string;
  name: string;
  memberCount: number;
  taskCount: number;
  activeCount: number;
}

export interface TeamTaskSummary {
  id: string;
  subject: string;
  owner: string;
  status: string;
}

export interface TeamMessageSummary {
  from: string;
  fromTool?: string;
  to: string;
  text: string;
  createdAt: string;
}

// ── Screen Types ──

export type Screen =
  | 'splash'
  | 'home'
  | 'host-list'
  | 'workspace-list'
  | 'session-list'
  | 'session-detail'
  | 'voice-input'
  | 'live-output'
  | 'action-result'
  | 'file-browser'
  | 'file-viewer'
  | 'session-diffs'
  | 'settings'
  | 'prompt-select'
  | 'port-browser'
  | 'schedules'
  | 'team-list'
  | 'team-detail'
  | 'team-chat';

// ── App State ──

export interface AppState {
  screen: Screen;
  // Hosts
  hosts: Host[];
  selectedHostId: string | null;
  hostStatuses: Record<string, 'connected' | 'disconnected'>;
  // Workspaces
  workspaces: Workspace[];
  selectedWorkspace: string | null;    // workspace path
  selectedWorkspaceHostId: string | null;
  // Sessions
  sessions: SessionSummary[];
  highlightedIndex: number;
  selectedSessionId: string | null;
  pendingResult: ActionResult | null;
  connectionStatus: 'connected' | 'connecting' | 'disconnected';
  // Voice input
  voiceText: string | null;
  voiceListening: boolean;
  // Live output / chat
  outputLines: string[];
  outputScrollOffset: number;
  chatHighlight: number;          // highlighted row in chat (for scrolling)
  expandedThinking: number[];     // IDs of expanded thinking blocks
  // File browser
  browserPath: string;            // current directory path
  browserEntries: FsEntry[];      // directory listing
  browserHighlight: number;       // selected entry index
  browserPickMode: boolean;       // true when picking a folder for new workspace
  fileContent: string | null;     // content of viewed file
  viewingFile: string | null;     // name of file being viewed
  fileScrollOffset: number;       // scroll position in file viewer
  // Session diffs (Phase 4)
  diffFiles: DiffFile[];
  // Settings (Phase 5)
  settings: Settings;
  // Prompts (Phase 6)
  prompts: Prompt[];
  // Ports (Phase 7)
  ports: PortEntry[];
  // Schedules
  scheduledTasks: ScheduledTask[];
  // Teams
  teams: TeamSummary[];
  selectedTeamId: string | null;
  teamTasks: TeamTaskSummary[];
  teamMessages: TeamMessageSummary[];
}
