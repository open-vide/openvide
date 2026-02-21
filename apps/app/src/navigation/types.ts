import type { NavigatorScreenParams } from "@react-navigation/native";
import type { QrConnectionPayload } from "../core/qrPayload";

export type MainStackParamList = {
  // Root screens (sidebar sections)
  WorkspaceList: undefined;
  Hosts: undefined;
  Settings: undefined;
  // Pushed screens
  WorkspaceDetail: { workspaceId: string };
  AiChat: { sessionId: string };
  DiffViewer: { diff: string; filePath?: string; language?: string };
  HostDetail: { targetId: string; autoDetect?: boolean };
  Terminal: { targetId: string };
  FileBrowser: { targetId: string; initialPath?: string };
  FileViewer: { targetId: string; filePath: string };
};

export type ModalStackParamList = {
  NewSessionSheet: { selectedDirectory?: string } | undefined;
  CreateWorkspaceSheet: { selectedDirectory?: string } | undefined;
  NewWorkspaceChatSheet: { workspaceId: string } | undefined;
  AddHostSheet: { qrPayload?: QrConnectionPayload } | undefined;
  QrScannerSheet: undefined;
  DirectoryPicker: { targetId: string; currentPath?: string; returnTo?: "NewSessionSheet" | "CreateWorkspaceSheet" };
  PromptLibrarySheet: undefined;
};

export type RootStackParamList = {
  Main: NavigatorScreenParams<MainStackParamList>;
} & ModalStackParamList;
