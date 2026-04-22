import type { AppState, Settings, FsEntry } from './types';
import type { Action } from './actions';
import { t, APP_LANGUAGES } from '../utils/i18n';
import type { AppLanguage } from '../utils/i18n';

const MAX_OUTPUT_LINES = 50;

const defaultSettings: Settings = {
  language: 'en',
  voiceLang: 'en-US',
  showToolDetails: true,
  pollInterval: 2500,
  showHiddenFiles: false,
  codexPermissionMode: 'auto',
  sttProvider: 'soniox',
  sttApiKey: '',
};

// Voice language cycle options
const VOICE_LANGS = ['en-US', 'it-IT', 'es-ES', 'fr-FR', 'de-DE', 'pt-BR', 'zh-CN', 'ja-JP'];
// Poll interval cycle options (ms)
const POLL_INTERVALS = [1000, 2500, 5000, 10000];

export const initialState: AppState = {
  screen: 'splash',
  hosts: [],
  selectedHostId: null,
  hostStatuses: {},
  workspaces: [],
  selectedWorkspace: null,
  selectedWorkspaceHostId: null,
  sessions: [],
  highlightedIndex: 0,
  selectedSessionId: null,
  pendingResult: null,
  connectionStatus: 'connecting',
  voiceText: null,
  voiceListening: false,
  outputLines: [],
  outputScrollOffset: 0,
  chatHighlight: 0,
  expandedThinking: [],
  browserPath: '~',
  browserEntries: [],
  browserHighlight: 0,
  browserPickMode: false,
  fileContent: null,
  viewingFile: null,
  fileScrollOffset: 0,
  // Phase 4
  diffFiles: [],
  // Phase 5
  settings: { ...defaultSettings },
  // Phase 6
  prompts: [],
  // Phase 7
  ports: [],
  // Schedules
  scheduledTasks: [],
  // Teams
  teams: [],
  selectedTeamId: null,
  teamTasks: [],
  teamMessages: [],
};

export interface ActionItem { id: string; label: string }

/** Actions available on session-detail screen. */
export function getSessionActions(state: AppState): ActionItem[] {
  const session = state.sessions.find((s) => s.id === state.selectedSessionId);
  if (!session) return [];
  const lang = state.settings.language;
  const actions: ActionItem[] = [];
  actions.push({ id: 'enterChat', label: t('action.enterChat', lang) });
  if (session.status === 'idle' || session.status === 'failed' || session.status === 'cancelled' || session.status === 'interrupted') {
    actions.push({ id: 'viewDiffs', label: t('action.viewDiffs', lang) });
  }
  if (session.status === 'running' || session.status === 'awaiting_approval') {
    actions.push({ id: 'cancel', label: t('action.cancel', lang) });
  }
  actions.push({ id: 'delete', label: t('action.delete', lang) });
  return actions;
}

/** Items on the home screen. */
/** Returns browser entries filtered and sorted the same way as the display. */
function getVisibleBrowserEntries(state: AppState): FsEntry[] {
  const filtered = state.settings.showHiddenFiles
    ? state.browserEntries
    : state.browserEntries.filter((e) => !e.name.startsWith('.'));
  return [...filtered].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function getHomeActions(state: AppState): ActionItem[] {
  const lang = state.settings.language;
  return [
    { id: 'viewWorkspaces', label: t('action.viewWorkspaces', lang) },
    { id: 'viewSessions', label: t('action.viewSessions', lang) },
    { id: 'viewHosts', label: t('action.viewHosts', lang) },
    { id: 'settings', label: t('action.settings', lang) },
    { id: 'viewPorts', label: t('action.viewPorts', lang) },
    { id: 'viewSchedules', label: 'Schedules' },
    { id: 'viewTeams', label: 'Teams' },
  ];
}

export function reduce(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'APP_INIT':
      return state;

    // ── Hosts ──

    case 'HOSTS_LOADED':
      return { ...state, hosts: action.hosts };

    case 'HOST_ADD':
      return { ...state, hosts: [...state.hosts, action.host] };

    case 'HOST_REMOVE':
      return {
        ...state,
        hosts: state.hosts.filter((h) => h.id !== action.hostId),
        selectedHostId: state.selectedHostId === action.hostId ? null : state.selectedHostId,
      };

    case 'HOST_SELECT':
      return {
        ...state,
        selectedHostId: action.hostId,
        screen: 'workspace-list',
        highlightedIndex: 0,
        selectedWorkspace: null,
        selectedWorkspaceHostId: null,
      };

    case 'HOST_STATUSES_UPDATED':
      return { ...state, hostStatuses: action.statuses };

    // ── Workspaces ──

    case 'WORKSPACES_UPDATED':
      return { ...state, workspaces: action.workspaces };

    case 'WORKSPACE_SELECT':
      return {
        ...state,
        selectedWorkspace: action.path,
        selectedWorkspaceHostId: action.hostId ?? null,
        screen: 'session-list',
        highlightedIndex: 0,
        sessions: state.sessions.filter((s) =>
          s.workingDirectory === action.path &&
          (!action.hostId || s.hostId === action.hostId)
        ),
      };

    // ── Sessions ──

    case 'SESSIONS_UPDATED':
      return { ...state, sessions: action.sessions };

    case 'CONNECTION_STATUS':
      return { ...state, connectionStatus: action.status };

    case 'NAVIGATE':
      return {
        ...state,
        screen: action.screen,
        highlightedIndex: 0,
        selectedSessionId: action.screen === 'home' ? null : state.selectedSessionId,
        pendingResult: null,
        voiceText: null,
        voiceListening: false,
        outputLines: action.screen === 'live-output' ? state.outputLines : [],
        outputScrollOffset: 0,   // 0 = at bottom
      };

    case 'HIGHLIGHT_MOVE': {
      let max: number;
      if (state.screen === 'home') {
        max = getHomeActions(state).length - 1;
      } else if (state.screen === 'session-detail') {
        max = getSessionActions(state).length - 1;
      } else if (state.screen === 'session-list') {
        max = state.sessions.length - 1;
      } else if (state.screen === 'host-list') {
        max = state.hosts.length - 1;
      } else if (state.screen === 'workspace-list') {
        // +2 for "New Workspace" and "Browse Files" entries
        max = state.workspaces.length + 1;
      } else if (state.screen === 'file-browser') {
        // +1 for ".." entry at top, +1 for "Select this folder" in pick mode
        const pickOffset = state.browserPickMode ? 1 : 0;
        max = getVisibleBrowserEntries(state).length + pickOffset;
        const idx =
          action.direction === 'down'
            ? Math.min(state.browserHighlight + 1, max)
            : Math.max(state.browserHighlight - 1, 0);
        return { ...state, browserHighlight: idx };
      } else if (state.screen === 'file-viewer') {
        return reduce(state, { type: 'FILE_SCROLL', direction: action.direction });
      } else if (state.screen === 'live-output') {
        return reduce(state, { type: 'CHAT_HIGHLIGHT_MOVE', direction: action.direction });
      } else if (state.screen === 'session-diffs') {
        max = state.diffFiles.length - 1;
      } else if (state.screen === 'settings') {
        max = 4; // 5 settings items (0-4)
      } else if (state.screen === 'prompt-select') {
        max = state.prompts.length; // +1 for "Voice Input" at top
      } else if (state.screen === 'port-browser') {
        max = state.ports.length - 1;
      } else if (state.screen === 'schedules') {
        max = state.scheduledTasks.length - 1;
      } else if (state.screen === 'team-list') {
        max = state.teams.length - 1;
      } else if (state.screen === 'team-detail') {
        max = state.teamTasks.length - 1;
      } else if (state.screen === 'team-chat') {
        return reduce(state, { type: 'CHAT_HIGHLIGHT_MOVE', direction: action.direction });
      } else {
        return state;
      }
      if (max < 0) return state;
      const idx =
        action.direction === 'down'
          ? Math.min(state.highlightedIndex + 1, max)
          : Math.max(state.highlightedIndex - 1, 0);
      return { ...state, highlightedIndex: idx };
    }

    case 'SELECT_HIGHLIGHTED': {
      if (state.screen === 'host-list') {
        const host = state.hosts[state.highlightedIndex];
        if (!host) return state;
        return reduce(state, { type: 'HOST_SELECT', hostId: host.id });
      }
      if (state.screen === 'workspace-list') {
        const extraIdx = state.highlightedIndex - state.workspaces.length;
        // "New Workspace" — open file browser in pick mode
        if (extraIdx === 0) {
          return { ...state, screen: 'file-browser', browserPath: '~', browserEntries: [], browserHighlight: 0, browserPickMode: true };
        }
        // "Browse Files"
        if (extraIdx === 1) {
          return reduce(state, { type: 'BROWSER_NAVIGATE', path: '~' });
        }
        const ws = state.workspaces[state.highlightedIndex];
        if (!ws) return state;
        return reduce(state, { type: 'WORKSPACE_SELECT', path: ws.path, hostId: ws.hostId });
      }
      if (state.screen === 'file-browser') {
        const pickOffset = state.browserPickMode ? 1 : 0;
        // Index 0 = ".." (go up)
        if (state.browserHighlight === 0) {
          const parentPath = state.browserPath === '~' ? '~' : state.browserPath.replace(/\/[^/]+$/, '') || '~';
          if (parentPath === state.browserPath) {
            return reduce(state, { type: 'GO_BACK' });
          }
          return reduce(state, { type: 'BROWSER_NAVIGATE', path: parentPath });
        }
        // Index 1 in pick mode = "Select this folder" — side effect handles workspace creation
        if (state.browserPickMode && state.browserHighlight === 1) {
          return state; // handled by side effect
        }
        const visible = getVisibleBrowserEntries(state);
        const entry = visible[state.browserHighlight - 1 - pickOffset];
        if (!entry) return state;
        if (entry.type === 'dir') {
          const newPath = state.browserPath === '~' ? `~/${entry.name}` : `${state.browserPath}/${entry.name}`;
          return reduce(state, { type: 'BROWSER_NAVIGATE', path: newPath });
        }
        // File: will be handled by side effect (fetch content)
        return state;
      }
      if (state.screen === 'prompt-select') {
        // Index 0 = "Voice Input", rest = prompts
        if (state.highlightedIndex === 0) {
          // Voice input selected — go to voice-input screen
          return {
            ...state,
            screen: 'voice-input',
            voiceListening: true,
            voiceText: null,
          };
        }
        // Prompt selected — handled by side effect
        return state;
      }
      if (state.screen === 'team-list') {
        const team = state.teams[state.highlightedIndex];
        if (!team) return state;
        return { ...state, selectedTeamId: team.id, screen: 'team-detail', highlightedIndex: 0, teamTasks: [], teamMessages: [] };
      }
      const target = state.sessions[state.highlightedIndex];
      if (!target) return state;
      return {
        ...state,
        selectedSessionId: target.id,
        screen: 'session-detail',
        highlightedIndex: 0,
      };
    }

    case 'PRIMARY_ACTION': {
      if (state.screen === 'home') {
        const actions = getHomeActions(state);
        const chosen = actions[state.highlightedIndex];
        if (chosen?.id === 'viewWorkspaces') {
          return { ...state, screen: 'workspace-list', highlightedIndex: 0 };
        }
        if (chosen?.id === 'viewHosts') {
          return { ...state, screen: 'host-list', highlightedIndex: 0 };
        }
        if (chosen?.id === 'viewSessions') {
          return { ...state, screen: 'session-list', highlightedIndex: 0 };
        }
        if (chosen?.id === 'settings') {
          return { ...state, screen: 'settings', highlightedIndex: 0 };
        }
        if (chosen?.id === 'viewPorts') {
          return { ...state, screen: 'port-browser', highlightedIndex: 0, ports: [] };
        }
        if (chosen?.id === 'viewSchedules') {
          return { ...state, screen: 'schedules', highlightedIndex: 0, scheduledTasks: [] };
        }
        if (chosen?.id === 'viewTeams') {
          return { ...state, screen: 'team-list', highlightedIndex: 0 };
        }
        return state;
      }
      if (state.screen === 'session-detail') {
        const actions = getSessionActions(state);
        const chosen = actions[state.highlightedIndex];
        if (!chosen) return state;

        if (chosen.id === 'enterChat') {
          return {
            ...state,
            screen: 'live-output',
            outputLines: [],
            outputScrollOffset: 0,
            chatHighlight: 0,
            expandedThinking: [],
          };
        }
        if (chosen.id === 'viewDiffs') {
          return {
            ...state,
            screen: 'session-diffs',
            highlightedIndex: 0,
            diffFiles: [],
          };
        }
        return state;
      }
      if (state.screen === 'settings') {
        return reduce(state, { type: 'SETTING_TOGGLE', key: settingsKeyAtIndex(state.highlightedIndex) });
      }
      if (state.screen === 'action-result') {
        return reduce(state, { type: 'CLEAR_RESULT' });
      }
      return state;
    }

    case 'ACTION_STARTED':
      return state;

    case 'ACTION_COMPLETED':
      if (state.screen === 'live-output') return state;
      return {
        ...state,
        pendingResult: action.result,
        screen: 'action-result',
      };

    case 'GO_BACK': {
      if (state.screen === 'session-detail') {
        return { ...state, screen: 'session-list', selectedSessionId: null, highlightedIndex: 0 };
      }
      if (state.screen === 'session-list') {
        // Go back to workspace list if we have a host selected, otherwise home
        if (state.selectedHostId) {
          return { ...state, screen: 'workspace-list', selectedWorkspace: null, selectedWorkspaceHostId: null, highlightedIndex: 0, sessions: [] };
        }
        return { ...state, screen: 'home', highlightedIndex: 0 };
      }
      if (state.screen === 'workspace-list') {
        if (state.selectedHostId) {
          return { ...state, screen: 'host-list', selectedHostId: null, highlightedIndex: 0, workspaces: [] };
        }
        return { ...state, screen: 'home', highlightedIndex: 0 };
      }
      if (state.screen === 'host-list') {
        return { ...state, screen: 'home', highlightedIndex: 0 };
      }
      if (state.screen === 'file-browser') {
        // Navigate to parent, or back to workspace-list if at root
        const parentPath = state.browserPath === '~' ? null : state.browserPath.replace(/\/[^/]+$/, '') || '~';
        if (!parentPath || parentPath === state.browserPath) {
          return { ...state, screen: 'workspace-list', highlightedIndex: 0 };
        }
        return reduce(state, { type: 'BROWSER_NAVIGATE', path: parentPath });
      }
      if (state.screen === 'file-viewer') {
        return { ...state, screen: 'file-browser', fileContent: null, viewingFile: null, fileScrollOffset: 0 };
      }
      if (state.screen === 'voice-input') {
        return { ...state, screen: 'session-detail', voiceListening: false, voiceText: null, highlightedIndex: 0 };
      }
      if (state.screen === 'live-output') {
        return { ...state, screen: 'session-detail', outputLines: [], outputScrollOffset: 0, highlightedIndex: 0 };
      }
      if (state.screen === 'action-result') {
        return {
          ...state,
          pendingResult: null,
          screen: state.sessions.length > 0 ? 'session-list' : 'home',
          selectedSessionId: null,
          highlightedIndex: 0,
        };
      }
      if (state.screen === 'session-diffs') {
        return { ...state, screen: 'session-detail', diffFiles: [], highlightedIndex: 0 };
      }
      if (state.screen === 'settings') {
        return { ...state, screen: 'home', highlightedIndex: 0 };
      }
      if (state.screen === 'prompt-select') {
        return { ...state, screen: 'session-detail', highlightedIndex: 0 };
      }
      if (state.screen === 'port-browser') {
        return { ...state, screen: 'home', highlightedIndex: 0, ports: [] };
      }
      if (state.screen === 'schedules') {
        return { ...state, screen: 'home', highlightedIndex: 0, scheduledTasks: [] };
      }
      if (state.screen === 'team-list') {
        return { ...state, screen: 'home', highlightedIndex: 0 };
      }
      if (state.screen === 'team-detail') {
        return { ...state, screen: 'team-list', selectedTeamId: null, highlightedIndex: 0, teamTasks: [] };
      }
      if (state.screen === 'team-chat') {
        return { ...state, screen: 'team-detail', highlightedIndex: 0 };
      }
      return state;
    }

    case 'CLEAR_RESULT': {
      return {
        ...state,
        pendingResult: null,
        screen: state.sessions.length > 0 ? 'session-list' : 'home',
        selectedSessionId: null,
        highlightedIndex: 0,
      };
    }

    // Voice
    case 'VOICE_START':
      return { ...state, voiceListening: true, voiceText: null };

    case 'VOICE_INTERIM':
      return { ...state, voiceText: action.text };

    case 'VOICE_FINAL':
      return { ...state, voiceText: action.text, voiceListening: false };

    case 'VOICE_ERROR':
      return { ...state, voiceListening: false, voiceText: `Error: ${action.error}` };

    case 'VOICE_CANCEL':
      return { ...state, screen: 'session-detail', voiceListening: false, voiceText: null, highlightedIndex: 0 };

    case 'VOICE_CLEAR':
      return { ...state, voiceListening: false, voiceText: null };

    // Live output
    case 'OUTPUT_LINE': {
      const lines = [...state.outputLines, action.line].slice(-MAX_OUTPUT_LINES);
      return { ...state, outputLines: lines };
    }

    case 'OUTPUT_SCROLL': {
      if (action.direction === 'up') {
        return { ...state, outputScrollOffset: state.outputScrollOffset + 1 };
      } else {
        return { ...state, outputScrollOffset: Math.max(0, state.outputScrollOffset - 1) };
      }
    }

    // Chat highlight & thinking
    case 'CHAT_HIGHLIGHT_MOVE': {
      const visibleCount = 8;
      const hi = state.chatHighlight;

      if (action.direction === 'up') {
        if (hi > 0) {
          return { ...state, chatHighlight: hi - 1 };
        }
        return reduce(state, { type: 'OUTPUT_SCROLL', direction: 'up' });
      } else {
        if (hi < visibleCount - 1) {
          return { ...state, chatHighlight: hi + 1 };
        }
        return reduce(state, { type: 'OUTPUT_SCROLL', direction: 'down' });
      }
    }

    case 'CHAT_TAP':
      return state;

    case 'TOGGLE_THINKING': {
      const id = action.thinkingId;
      const expanded = state.expandedThinking.includes(id)
        ? state.expandedThinking.filter((x) => x !== id)
        : [...state.expandedThinking, id];
      return { ...state, expandedThinking: expanded };
    }

    // File browser
    case 'BROWSER_ENTRIES':
      return {
        ...state,
        browserEntries: action.entries,
        browserPath: action.path,
      };

    case 'BROWSER_NAVIGATE':
      return {
        ...state,
        screen: 'file-browser',
        browserPath: action.path,
        browserHighlight: 0,
        browserEntries: [],
        fileContent: null,
      };

    case 'FILE_CONTENT':
      return {
        ...state,
        screen: 'file-viewer',
        fileContent: action.content,
        viewingFile: action.fileName,
        fileScrollOffset: 0,
      };

    case 'FILE_SCROLL': {
      if (action.direction === 'up') {
        return { ...state, fileScrollOffset: Math.max(0, state.fileScrollOffset - 1) };
      } else {
        return { ...state, fileScrollOffset: state.fileScrollOffset + 1 };
      }
    }

    // ── Session Diffs (Phase 4) ──

    case 'DIFFS_LOADED':
      return { ...state, diffFiles: action.files };

    case 'DIFFS_CLEAR':
      return { ...state, diffFiles: [] };

    // ── Settings (Phase 5) ──

    case 'SETTINGS_LOADED':
      return { ...state, settings: action.settings };

    case 'SETTING_TOGGLE': {
      const s = { ...state.settings };
      switch (action.key) {
        case 'language': {
          const langIds = APP_LANGUAGES.map(l => l.id);
          const li = langIds.indexOf(s.language);
          s.language = langIds[(li + 1) % langIds.length] as AppLanguage;
          break;
        }
        case 'voiceLang': {
          const idx = VOICE_LANGS.indexOf(s.voiceLang);
          s.voiceLang = VOICE_LANGS[(idx + 1) % VOICE_LANGS.length];
          break;
        }
        case 'showToolDetails':
          s.showToolDetails = !s.showToolDetails;
          break;
        case 'pollInterval': {
          const pi = POLL_INTERVALS.indexOf(s.pollInterval);
          s.pollInterval = POLL_INTERVALS[(pi + 1) % POLL_INTERVALS.length];
          break;
        }
        case 'showHiddenFiles':
          s.showHiddenFiles = !s.showHiddenFiles;
          break;
      }
      return { ...state, settings: s };
    }

    // ── Prompts (Phase 6) ──

    case 'PROMPTS_LOADED':
      return { ...state, prompts: action.prompts };

    case 'PROMPT_SELECT':
      // Handled by side effect (sends prompt or navigates to voice)
      return state;

    // ── Ports (Phase 7) ──

    case 'PORTS_LOADED':
      return { ...state, ports: action.ports };

    // ── Schedules ──

    case 'SCHEDULES_LOADED':
      return { ...state, scheduledTasks: action.schedules };

    // ── Teams ──

    case 'TEAMS_LOADED':
      return { ...state, teams: action.teams };

    case 'TEAM_SELECT':
      return { ...state, selectedTeamId: action.teamId, screen: 'team-detail', highlightedIndex: 0, teamTasks: [], teamMessages: [] };

    case 'TEAM_TASKS_LOADED':
      return { ...state, teamTasks: action.tasks };

    case 'TEAM_MESSAGES_LOADED':
      return { ...state, teamMessages: action.messages };

    default:
      return state;
  }
}

/** Map settings highlight index to settings key. */
function settingsKeyAtIndex(index: number): keyof Settings {
  switch (index) {
    case 0: return 'language';
    case 1: return 'voiceLang';
    case 2: return 'showToolDetails';
    case 3: return 'pollInterval';
    case 4: return 'showHiddenFiles';
    default: return 'language';
  }
}
