import type { SessionSummary, ActionResult, Screen, Host, Workspace, FsEntry, DiffFile, Settings, Prompt, PortEntry, ScheduledTask, TeamSummary, TeamTaskSummary, TeamMessageSummary } from './types';

export type Action =
  | { type: 'APP_INIT' }
  | { type: 'SESSIONS_UPDATED'; sessions: SessionSummary[] }
  | { type: 'CONNECTION_STATUS'; status: 'connected' | 'connecting' | 'disconnected' }
  | { type: 'NAVIGATE'; screen: Screen }
  | { type: 'HIGHLIGHT_MOVE'; direction: 'up' | 'down' }
  | { type: 'SELECT_HIGHLIGHTED' }
  | { type: 'PRIMARY_ACTION' }
  | { type: 'ACTION_STARTED'; action: string; sessionId: string }
  | { type: 'ACTION_COMPLETED'; result: ActionResult }
  | { type: 'GO_BACK' }
  | { type: 'CLEAR_RESULT' }
  | { type: 'VOICE_START' }
  | { type: 'VOICE_INTERIM'; text: string }
  | { type: 'VOICE_FINAL'; text: string }
  | { type: 'VOICE_ERROR'; error: string }
  | { type: 'VOICE_CANCEL' }
  | { type: 'VOICE_CLEAR' }
  | { type: 'OUTPUT_LINE'; line: string }
  | { type: 'OUTPUT_SCROLL'; direction: 'up' | 'down' }
  | { type: 'TOGGLE_THINKING'; thinkingId: number }
  | { type: 'CHAT_HIGHLIGHT_MOVE'; direction: 'up' | 'down' }
  | { type: 'CHAT_TAP' }
  // Hosts
  | { type: 'HOSTS_LOADED'; hosts: Host[] }
  | { type: 'HOST_ADD'; host: Host }
  | { type: 'HOST_REMOVE'; hostId: string }
  | { type: 'HOST_SELECT'; hostId: string }
  | { type: 'HOST_STATUSES_UPDATED'; statuses: Record<string, 'connected' | 'disconnected'> }
  // Workspaces
  | { type: 'WORKSPACES_UPDATED'; workspaces: Workspace[] }
  | { type: 'WORKSPACE_SELECT'; path: string; hostId?: string }
  // File browser
  | { type: 'BROWSER_ENTRIES'; entries: FsEntry[]; path: string }
  | { type: 'BROWSER_NAVIGATE'; path: string }
  | { type: 'FILE_CONTENT'; content: string; fileName: string }
  | { type: 'FILE_SCROLL'; direction: 'up' | 'down' }
  // Session diffs (Phase 4)
  | { type: 'DIFFS_LOADED'; files: DiffFile[] }
  | { type: 'DIFFS_CLEAR' }
  // Settings (Phase 5)
  | { type: 'SETTINGS_LOADED'; settings: Settings }
  | { type: 'SETTING_TOGGLE'; key: keyof Settings }
  // Prompts (Phase 6)
  | { type: 'PROMPTS_LOADED'; prompts: Prompt[] }
  | { type: 'PROMPT_SELECT'; prompt: Prompt | null }  // null = voice input
  // Ports (Phase 7)
  | { type: 'PORTS_LOADED'; ports: PortEntry[] }
  // Schedules
  | { type: 'SCHEDULES_LOADED'; schedules: ScheduledTask[] }
  // Teams
  | { type: 'TEAMS_LOADED'; teams: TeamSummary[] }
  | { type: 'TEAM_SELECT'; teamId: string }
  | { type: 'TEAM_TASKS_LOADED'; tasks: TeamTaskSummary[] }
  | { type: 'TEAM_MESSAGES_LOADED'; messages: TeamMessageSummary[] };
