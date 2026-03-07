import { AppState, type AppStateStatus } from "react-native";
import * as Updates from "expo-updates";

const MIN_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let lastCheckTime = 0;

/**
 * Start a background update checker that runs on app foreground.
 * Checks at most every 5 minutes. Update applies on next cold start.
 * Skipped in development mode (__DEV__).
 *
 * Returns a cleanup function to remove the AppState listener.
 */
export function startUpdateChecker(): () => void {
  if (__DEV__) {
    return () => {};
  }

  let lastState: AppStateStatus = AppState.currentState;

  const sub = AppState.addEventListener("change", (nextState) => {
    if (lastState.match(/inactive|background/) && nextState === "active") {
      void checkForUpdate();
    }
    lastState = nextState;
  });

  // Also check on initial mount
  void checkForUpdate();

  return () => sub.remove();
}

async function checkForUpdate(): Promise<void> {
  const now = Date.now();
  if (now - lastCheckTime < MIN_CHECK_INTERVAL_MS) {
    return;
  }
  lastCheckTime = now;

  try {
    const check = await Updates.checkForUpdateAsync();
    if (check.isAvailable) {
      __DEV__ && console.log("[OV:updates] Update available, fetching...");
      await Updates.fetchUpdateAsync();
      __DEV__ && console.log("[OV:updates] Update fetched, will apply on next cold start");
    }
  } catch (err) {
    __DEV__ && console.log(`[OV:updates] Check failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
