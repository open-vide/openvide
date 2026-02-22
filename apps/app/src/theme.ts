import { createTheme } from "./lib/tokens";

/**
 * open-vide theme — warm cream / dark gray dual palette.
 * Light: terracotta accent on warm cream.
 * Dark: lighter terracotta on dark gray.
 */
export const remoteDevTheme = createTheme({
  colors: {
    background: { light: "#FAF7F2", dark: "#171614" },
    foreground: { light: "#1A1A1A", dark: "#F2EEE8" },
    card: { light: "#FFFFFF", dark: "#23211F" },
    muted: { light: "#F0EDE8", dark: "#2E2B28" },
    mutedForeground: { light: "#8E8E93", dark: "#AAA59C" },
    primary: { light: "#1A1A1A", dark: "#F2EEE8" },
    primaryForeground: { light: "#FFFFFF", dark: "#171614" },
    destructive: { light: "#E74C3C", dark: "#FF6E5F" },
    success: { light: "#34C759", dark: "#45D08C" },
    warning: { light: "#F5A623", dark: "#F4C86E" },
    error: { light: "#E74C3C", dark: "#FF6E5F" },
    info: { light: "#C4704B", dark: "#D4836B" },
    border: { light: "#E5E2DD", dark: "#4A4640" },
    ring: { light: "#C4704B", dark: "#D4836B" },
  },
});
