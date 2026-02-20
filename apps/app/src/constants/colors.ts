import { useColorScheme } from "nativewind";
import { remoteDevTheme } from "../theme";

type Mode = "light" | "dark";

function resolve(mode: Mode) {
  const t = remoteDevTheme.colors;
  return {
    // Semantic tokens
    background: t.background[mode],
    foreground: t.foreground[mode],
    card: t.card[mode],
    muted: t.muted[mode],
    mutedForeground: t.mutedForeground[mode],
    primary: t.primary[mode],
    primaryForeground: t.primaryForeground[mode],
    destructive: t.destructive[mode],
    success: t.success[mode],
    warning: t.warning[mode],
    error: t.error[mode],
    border: t.border[mode],
    ring: t.ring[mode],

    // Accent (terracotta)
    accent: mode === "light" ? "#C4704B" : "#D4836B",

    // App-specific semantic aliases
    headerBg: t.background[mode],
    pressedPrimary: mode === "light" ? "#3A3A3C" : "#636366",
    dimmed: mode === "light" ? "#AEAEB2" : "#636366",
    white: "#FFFFFF",
    black: "#000000",
    lightForeground: t.foreground[mode],

    // Status variants
    errorBg: mode === "light" ? "#FEF2F2" : "#3A2020",
    errorLight: "#fca5a5",
    errorBright: "#f87171",
    warningLight: mode === "light" ? "#F5A623" : "#FFD60A",

    // Neutral grays
    neutral: mode === "light" ? "#8E8E93" : "#636366",

    // Tool badge colors (app-specific)
    toolClaude: "#C4704B",
    toolCodex: "#10A37F",
    toolGemini: "#4285F4",

    // Timeout/special
    timeout: "#ea580c",
  } as const;
}

/** Static light-mode colors for non-hook contexts */
export const colors = resolve("light");

/** Hook that returns theme-aware colors + scheme controls */
export function useThemeColors() {
  const { colorScheme, setColorScheme, toggleColorScheme } = useColorScheme();
  const mode: Mode = colorScheme === "dark" ? "dark" : "light";
  return { ...resolve(mode), colorScheme: colorScheme ?? "light", setColorScheme, toggleColorScheme };
}
