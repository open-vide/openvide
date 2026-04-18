import { createGlassScreenRouter } from 'even-toolkit/glass-screen-router';
import type { OpenVideSnapshot, OpenVideActions } from './types';
import { homeScreen } from './screens/home';
import { sessionListScreen } from './screens/session-list';
import { hostListScreen } from './screens/host-list';
import { workspaceDetailScreen } from './screens/workspace-detail';
import { liveOutputScreen } from './screens/live-output';
import { voiceInputScreen } from './screens/voice-input';
import { teamListScreen } from './screens/team-list';
import { teamDetailScreen } from './screens/team-detail';
import { teamChatScreen } from './screens/team-chat';
import { settingsScreen } from './screens/settings';
import { promptSelectScreen } from './screens/prompt-select';
import { schedulesScreen } from './screens/schedules';
import { fileBrowserScreen } from './screens/file-browser';
import { fileViewerScreen } from './screens/file-viewer';
import { sessionDiffsScreen } from './screens/session-diffs';
import { toolPickerScreen } from './screens/tool-picker';

export type { OpenVideSnapshot, OpenVideActions };

export const { toDisplayData, onGlassAction } = createGlassScreenRouter<OpenVideSnapshot, OpenVideActions>({
  'home': homeScreen,
  'session-list': sessionListScreen,
  'host-list': hostListScreen,
  'workspace-detail': workspaceDetailScreen,
  'live-output': liveOutputScreen,
  'voice-input': voiceInputScreen,
  'team-list': teamListScreen,
  'team-detail': teamDetailScreen,
  'team-chat': teamChatScreen,
  'settings': settingsScreen,
  'prompt-select': promptSelectScreen,
  'schedules': schedulesScreen,
  'file-browser': fileBrowserScreen,
  'file-viewer': fileViewerScreen,
  'session-diffs': sessionDiffsScreen,
  'tool-picker': toolPickerScreen,
}, 'home');
