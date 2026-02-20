import { createTheme } from "./lib/tokens";

/**
 * open-vide theme — warm cream / dark gray dual palette.
 * Light: terracotta accent on warm cream.
 * Dark: lighter terracotta on dark gray.
 */
export const remoteDevTheme = createTheme({
  colors: {
    background: { light: "#FAF7F2", dark: "#1C1C1E" },
    foreground: { light: "#1A1A1A", dark: "#F5F5F7" },
    card: { light: "#FFFFFF", dark: "#2C2C2E" },
    muted: { light: "#F0EDE8", dark: "#3A3A3C" },
    mutedForeground: { light: "#8E8E93", dark: "#8E8E93" },
    primary: { light: "#1A1A1A", dark: "#F5F5F7" },
    primaryForeground: { light: "#FFFFFF", dark: "#1C1C1E" },
    destructive: { light: "#E74C3C", dark: "#FF453A" },
    success: { light: "#34C759", dark: "#30D158" },
    warning: { light: "#F5A623", dark: "#FFD60A" },
    error: { light: "#E74C3C", dark: "#FF453A" },
    info: { light: "#C4704B", dark: "#D4836B" },
    border: { light: "#E5E2DD", dark: "#3A3A3C" },
    ring: { light: "#C4704B", dark: "#D4836B" },
  },
});
