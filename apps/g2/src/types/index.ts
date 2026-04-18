export interface WebSession {
  id: string;
  hostId?: string;
  tool: string;
  status: string;
  runKind?: 'interactive' | 'scheduled' | 'team';
  scheduleId?: string;
  scheduleName?: string;
  teamId?: string;
  teamName?: string;
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
}

export interface WebWorkspace {
  path: string;
  hostId?: string;
  name: string;
  sessionCount: number;
  runningCount: number;
}

export interface WebHost {
  id: string;
  name: string;
  url: string;
  token?: string;
  accessToken?: string;
  refreshToken?: string;
  authSessionId?: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
}

export interface DiffFile {
  path: string;
  added: number;
  removed: number;
  isNew: boolean;
}

export interface PortEntry {
  port: number;
  process: string;
  pid: number;
  address: string;
}

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

export interface ModelInfo {
  id: string;
  displayName: string;
  hidden: boolean;
  isDefault: boolean;
}

export interface WebSettings {
  language: string;
  voiceLang: string;
  showToolDetails: boolean;
  pollInterval: number;
  showHiddenFiles: boolean;
  sttProvider: 'soniox' | 'whisper-api' | 'deepgram';
  sttApiKey: string;
  sttApiKeySoniox: string;
  sttApiKeyWhisper: string;
  sttApiKeyDeepgram: string;
}

export interface WebBridgeConfig {
  enabled: boolean;
  port: number;
  tls: boolean;
  defaultCwd: string;
  evenAiTool: 'claude' | 'codex' | 'gemini';
  evenAiMode: 'new' | 'last' | 'pinned';
  evenAiPinnedSessionId: string;
  currentEvenAiSessionId: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolUse?: { name: string; input: string };
  thinking?: string;
  isStreaming?: boolean;
}

export interface HostHealthInfo {
  ok: boolean;
  pid?: number;
  activeSessions?: number;
  totalSessions?: number;
  name?: string;
  version?: string;
  tls?: boolean;
  tools?: Record<string, boolean>;
}

export interface BrowserEntry {
  name: string;
  type: string;
  size: number;
  modifiedAt: string;
}
