import type { NavigatorScreenParams } from "@react-navigation/native";
import type { QrConnectionPayload } from "../core/qrPayload";

export type MainStackParamList = {
  // Root screens (sidebar sections)
  WorkspaceList: undefined;
  Hosts: undefined;
  Settings: undefined;
  // Pushed screens
  WorkspaceDetail: { workspaceId: string };
  NewWorkspaceChatSheet: { workspaceId: string } | undefined;
  AiChat: { sessionId: string; initialPrompt?: string; workspaceId?: string };
  DiffViewer: { diff: string; filePath?: string; language?: string };
  HostDetail: { targetId: string; autoDetect?: boolean };
  Terminal: { targetId: string; initialDirectory?: string };
  FileBrowser: { targetId: string; initialPath?: string };
  FileViewer: { targetId: string; filePath: string };
  PortBrowser: { targetId: string };
  WebPreview: { targetId: string; url: string; title?: string };
  FileEditor: { targetId: string; filePath: string };
  SessionDiffs: { targetId: string; workingDirectory: string };
};

export type ModalStackParamList = {
  NewSessionSheet: { selectedDirectory?: string } | undefined;
  CreateWorkspaceSheet: { selectedDirectory?: string; selectedTargetId?: string; nameValue?: string; nameEdited?: boolean } | undefined;
  AddHostSheet: { qrPayload?: QrConnectionPayload } | undefined;
  QrScannerSheet: undefined;
  DirectoryPicker: { targetId: string; currentPath?: string; returnTo?: "NewSessionSheet" | "CreateWorkspaceSheet"; returnState?: Record<string, unknown> };
  PromptLibrarySheet: undefined;
};

export type RootStackParamList = {
  Main: NavigatorScreenParams<MainStackParamList>;
} & ModalStackParamList;
