import { createHashRouter } from 'react-router';
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
import { BridgeProbeRoute } from './screens/bridge-probe';

export const router = createHashRouter([
  // Probe page outside Shell — no context dependencies
  { path: '/probe', element: <BridgeProbeRoute /> },
  {
    element: <Shell />,
    children: [
      { path: '/', element: <WorkspacesRoute /> },
      { path: '/workspace', element: <WorkspaceDetailRoute /> },
      { path: '/sessions', element: <SessionsRoute /> },
      { path: '/chat', element: <ChatRoute /> },
      { path: '/diffs', element: <DiffsRoute /> },
      { path: '/hosts', element: <HostsRoute /> },
      { path: '/host', element: <HostDetailRoute /> },
      { path: '/files', element: <FilesRoute /> },
      { path: '/ports', element: <PortsRoute /> },
      { path: '/settings', element: <SettingsRoute /> },
      { path: '/prompts', element: <PromptsRoute /> },
    ],
  },
]);
