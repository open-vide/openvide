import "./global.css";
import React, { useEffect, useMemo, useRef } from "react";
import { Pressable, StatusBar } from "react-native";
import { DefaultTheme, NavigationContainer, type NavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { RootStackParamList } from "./src/navigation/types";
import { registerNotificationCategories, addNotificationTapHandler } from "./src/core/notifications";
import { startUpdateChecker } from "./src/core/updates";
import { DrawerLayout } from "./src/navigation/DrawerLayout";
import { NewSessionSheet } from "./src/screens/NewSessionSheet";
import { CreateWorkspaceSheet } from "./src/screens/CreateWorkspaceSheet";
import { AddHostSheet } from "./src/screens/AddHostSheet";
import { QrScannerSheet } from "./src/screens/QrScannerSheet";
import { DirectoryPicker } from "./src/screens/DirectoryPicker";
import { PromptLibraryScreen } from "./src/screens/PromptLibraryScreen";
import { AppStoreProvider } from "./src/state/AppStoreContext";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { Icon } from "./src/components/Icon";
import { useThemeColors } from "./src/constants/colors";
import { GlassProvider } from "./src/components/GlassContainer";
import { BiometricGate } from "./src/components/BiometricGate";
import { AnimatedSplash } from "./src/components/AnimatedSplash";
import { AppThemeProvider, useAppTheme } from "./src/theme/AppThemeProvider";

function ThemeStatusBar(): JSX.Element {
  const { resolvedMode } = useAppTheme();
  return <StatusBar barStyle={resolvedMode === "dark" ? "light-content" : "dark-content"} />;
}

const RootStack = createNativeStackNavigator<RootStackParamList>();

function ModalCloseButton({ onPress, color }: { onPress: () => void; color: string }): JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      className="w-10 h-10 items-center justify-center active:opacity-80"
    >
      <Icon name="x" size={20} color={color} />
    </Pressable>
  );
}

function RootNavigator(): JSX.Element {
  const { background, foreground, card, accent, border } = useThemeColors();
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);
  const navigationTheme = useMemo(() => ({
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background,
      card,
      text: foreground,
      primary: accent,
      border,
      notification: accent,
    },
  }), [background, card, foreground, accent, border]);

  useEffect(() => {
    registerNotificationCategories().catch(() => {});
    const cleanupNotifications = addNotificationTapHandler((sessionId) => {
      if (navigationRef.current) {
        navigationRef.current.navigate("Main", {
          screen: "AiChat",
          params: { sessionId },
        });
      }
    });
    const cleanupUpdates = startUpdateChecker();
    return () => {
      cleanupNotifications();
      cleanupUpdates();
    };
  }, []);

  return (
    <NavigationContainer ref={navigationRef} theme={navigationTheme}>
      <RootStack.Navigator>
        <RootStack.Screen
          name="Main"
          component={DrawerLayout}
          options={{ headerShown: false }}
        />
        <RootStack.Group screenOptions={{
          presentation: "modal",
          headerStyle: { backgroundColor: background },
          headerTintColor: foreground,
          contentStyle: { backgroundColor: card },
        }}>
          <RootStack.Screen
            name="NewSessionSheet"
            component={NewSessionSheet}
            options={({ navigation }) => ({
              title: "New Session",
              headerLeft: () => (
                <ModalCloseButton onPress={() => navigation.goBack()} color={foreground} />
              ),
            })}
          />
          <RootStack.Screen
            name="CreateWorkspaceSheet"
            component={CreateWorkspaceSheet}
            options={({ navigation }) => ({
              title: "Create Workspace",
              headerLeft: () => (
                <ModalCloseButton onPress={() => navigation.goBack()} color={foreground} />
              ),
            })}
          />
          <RootStack.Screen
            name="AddHostSheet"
            component={AddHostSheet}
            options={({ navigation }) => ({
              title: "Add Host",
              headerLeft: () => (
                <ModalCloseButton onPress={() => navigation.goBack()} color={foreground} />
              ),
            })}
          />
          <RootStack.Screen
            name="QrScannerSheet"
            component={QrScannerSheet}
            options={({ navigation }) => ({
              title: "Scan QR Code",
              headerLeft: () => (
                <ModalCloseButton onPress={() => navigation.goBack()} color={foreground} />
              ),
            })}
          />
          <RootStack.Screen
            name="DirectoryPicker"
            component={DirectoryPicker}
            options={({ navigation }) => ({
              title: "Pick Directory",
              headerLeft: () => (
                <ModalCloseButton onPress={() => navigation.goBack()} color={foreground} />
              ),
            })}
          />
          <RootStack.Screen
            name="PromptLibrarySheet"
            component={PromptLibraryScreen}
            options={({ navigation }) => ({
              title: "Prompt Library",
              headerLeft: () => (
                <ModalCloseButton onPress={() => navigation.goBack()} color={foreground} />
              ),
              headerRight: () => (
                <Pressable
                  onPress={() => {
                    // PromptLibraryScreen handles its own headerRight via setOptions
                  }}
                  className="w-10 h-10 items-center justify-center active:opacity-80"
                >
                  <Icon name="plus" size={24} color={accent} />
                </Pressable>
              ),
            })}
          />
        </RootStack.Group>
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

export default function App(): JSX.Element {
  return (
    <GestureHandlerRootView className="flex-1">
      <SafeAreaProvider>
        <AppThemeProvider>
          <AnimatedSplash>
            <BiometricGate>
              <GlassProvider>
                <AppStoreProvider>
                  <ErrorBoundary>
                    <ThemeStatusBar />
                    <RootNavigator />
                  </ErrorBoundary>
                </AppStoreProvider>
              </GlassProvider>
            </BiometricGate>
          </AnimatedSplash>
        </AppThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
