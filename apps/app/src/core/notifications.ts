import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import type { ToolName } from "./types";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/** Register notification categories with action buttons */
export async function registerNotificationCategories(): Promise<void> {
  await Notifications.setNotificationCategoryAsync("AI_SESSION", [
    { identifier: "open", buttonTitle: "Open", options: { opensAppToForeground: true } },
  ]);
}

export async function requestPermissions(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

export async function notifySessionComplete(
  sessionId: string,
  tool: ToolName,
  summary?: string,
): Promise<void> {
  const toolLabel = tool.charAt(0).toUpperCase() + tool.slice(1);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${toolLabel} session completed`,
      body: summary ?? "The AI session has finished.",
      data: { sessionId, type: "session_complete" },
      categoryIdentifier: "AI_SESSION",
    },
    trigger: null,
  });
}

export async function notifySessionFailed(
  sessionId: string,
  tool: ToolName,
  error: string,
): Promise<void> {
  const toolLabel = tool.charAt(0).toUpperCase() + tool.slice(1);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${toolLabel} session failed`,
      body: error.slice(0, 200),
      data: { sessionId, type: "session_failed" },
      categoryIdentifier: "AI_SESSION",
    },
    trigger: null,
  });
}

export async function notifySessionNeedsInput(
  sessionId: string,
  tool: ToolName,
): Promise<void> {
  const toolLabel = tool.charAt(0).toUpperCase() + tool.slice(1);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${toolLabel} needs your input`,
      body: "The AI session is waiting for a response.",
      data: { sessionId, type: "session_needs_input" },
      categoryIdentifier: "AI_SESSION",
    },
    trigger: null,
  });
}

/** Add notification tap handler - returns cleanup function */
export function addNotificationTapHandler(
  onTap: (sessionId: string) => void,
): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      const sessionId = data?.sessionId;
      if (typeof sessionId === "string") {
        onTap(sessionId);
      }
    },
  );
  return () => subscription.remove();
}

/**
 * Request push notification permissions and return an Expo push token.
 * Returns null if permissions denied, not on a physical device, or projectId
 * is missing from app config.
 */
export async function getExpoPushToken(): Promise<string | null> {
  try {
    // Push tokens only work on physical devices
    if (!Device.isDevice) {
      __DEV__ && console.log("[OV:push] Not a physical device, skipping push token");
      return null;
    }

    // Android requires a notification channel
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#3b82f6",
      });
    }

    const granted = await requestPermissions();
    if (!granted) {
      __DEV__ && console.log("[OV:push] Notification permissions not granted");
      return null;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    if (!projectId) {
      __DEV__ && console.log("[OV:push] No EAS projectId in config, skipping push token");
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    __DEV__ && console.log(`[OV:push] Got push token: ${tokenData.data}`);
    return tokenData.data;
  } catch (err) {
    __DEV__ && console.log(`[OV:push] Failed to get push token: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
