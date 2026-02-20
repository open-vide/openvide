import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { MainStackParamList } from "./types";

import { WorkspaceListScreen } from "../screens/WorkspaceListScreen";
import { WorkspaceDetailScreen } from "../screens/WorkspaceDetailScreen";
import { AiChatScreen } from "../screens/AiChatScreen";
import { DiffViewerScreen } from "../screens/DiffViewerScreen";
import { HostsScreen } from "../screens/HostsScreen";
import { HostDetailScreen } from "../screens/HostDetailScreen";
import { TerminalScreen } from "../screens/TerminalScreen";
import { FileBrowserScreen } from "../screens/FileBrowserScreen";
import { FileViewerScreen } from "../screens/FileViewerScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { HamburgerButton } from "../components/HamburgerButton";
import { useThemeColors } from "../constants/colors";

const Stack = createNativeStackNavigator<MainStackParamList>();

export function MainNavigator(): JSX.Element {
  const { headerBg, foreground, background } = useThemeColors();

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: headerBg },
        headerTintColor: foreground,
        contentStyle: { backgroundColor: background },
      }}
    >
      {/* Root screens — get hamburger button */}
      <Stack.Screen
        name="WorkspaceList"
        component={WorkspaceListScreen}
        options={{
          title: "Workspaces",
          headerLeft: () => <HamburgerButton />,
        }}
      />
      <Stack.Screen
        name="Hosts"
        component={HostsScreen}
        options={{
          title: "Hosts",
          headerLeft: () => <HamburgerButton />,
        }}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: "Settings",
          headerLeft: () => <HamburgerButton />,
        }}
      />

      {/* Pushed screens — default back button */}
      <Stack.Screen
        name="WorkspaceDetail"
        component={WorkspaceDetailScreen}
        options={{ title: "Workspace", headerBackButtonDisplayMode: "minimal" }}
      />
      <Stack.Screen
        name="AiChat"
        component={AiChatScreen}
        options={{ title: "Chat", headerBackButtonDisplayMode: "minimal" }}
      />
      <Stack.Screen
        name="DiffViewer"
        component={DiffViewerScreen}
        options={{ title: "Diff" }}
      />
      <Stack.Screen
        name="HostDetail"
        component={HostDetailScreen}
        options={{ title: "Host" }}
      />
      <Stack.Screen
        name="Terminal"
        component={TerminalScreen}
        options={{ title: "Terminal" }}
      />
      <Stack.Screen
        name="FileBrowser"
        component={FileBrowserScreen}
        options={{ title: "Files" }}
      />
      <Stack.Screen
        name="FileViewer"
        component={FileViewerScreen}
        options={{ title: "File" }}
      />
    </Stack.Navigator>
  );
}
