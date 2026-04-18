import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router';
import { BridgeProvider } from './contexts/bridge';
import { VoiceProvider } from './contexts/voice';
import { Shell } from './layouts/shell';
import { WorkspacesRoute } from './screens/workspaces';
import { WorkspaceDetailRoute } from './screens/workspace-detail';
import { SessionsRoute } from './screens/sessions';
import { ChatRoute } from './screens/chat';
import { DiffsRoute } from './screens/diffs';
import { HostsRoute } from './screens/hosts';
import { HostDetailRoute } from './screens/host-detail';
import { FilesRoute } from './screens/files';
import { PortsRoute } from './screens/ports';
import { SettingsRoute } from './screens/settings';
import { PromptsRoute } from './screens/prompts';
import { VoiceInputRoute } from './screens/voice-input';
import { ToolPickerRoute } from './screens/tool-picker';
import { BridgeProbeRoute } from './screens/bridge-probe';
import { SchedulesRoute } from './screens/schedules';
import { TeamsRoute } from './screens/teams';
import { TeamDetailRoute } from './screens/team-detail';
import { TeamChatRoute } from './screens/team-chat';
import { OpenVideGlasses } from './glass/OpenVideGlasses';
import { GuideRoute } from './screens/guide';
import { OpenVideGuideGate } from './components/guide/openvide-guide-gate';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BridgeProvider>
        <VoiceProvider>
        <BrowserRouter>
          <OpenVideGlasses />
          <OpenVideGuideGate />
          <Routes>
            <Route element={<Shell />}>
              <Route path="/" element={<WorkspacesRoute />} />
              <Route path="/workspace" element={<WorkspaceDetailRoute />} />
              <Route path="/sessions" element={<SessionsRoute />} />
              <Route path="/chat" element={<ChatRoute />} />
              <Route path="/voice-input" element={<VoiceInputRoute />} />
              <Route path="/prompt-select" element={<VoiceInputRoute />} />
              <Route path="/diffs" element={<DiffsRoute />} />
              <Route path="/hosts" element={<HostsRoute />} />
              <Route path="/host" element={<HostDetailRoute />} />
              <Route path="/files" element={<FilesRoute />} />
              <Route path="/ports" element={<PortsRoute />} />
              <Route path="/settings" element={<SettingsRoute />} />
              <Route path="/guide" element={<GuideRoute />} />
              <Route path="/prompts" element={<PromptsRoute />} />
              <Route path="/schedules" element={<SchedulesRoute />} />
              <Route path="/teams" element={<TeamsRoute />} />
              <Route path="/team" element={<TeamDetailRoute />} />
              <Route path="/team-chat" element={<TeamChatRoute />} />
              <Route path="/tool-picker" element={<ToolPickerRoute />} />
            </Route>
            {/* Standalone routes — outside Shell */}
            <Route path="/probe" element={<BridgeProbeRoute />} />
          </Routes>
        </BrowserRouter>
        </VoiceProvider>
      </BridgeProvider>
    </QueryClientProvider>
  );
}
