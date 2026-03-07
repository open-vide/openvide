import type { AppColorMode } from "./colorTokens";

let currentResolvedThemeMode: AppColorMode = "light";

export function setResolvedThemeMode(mode: AppColorMode): void {
  currentResolvedThemeMode = mode;
}

export function getResolvedThemeMode(): AppColorMode {
  return currentResolvedThemeMode;
}
