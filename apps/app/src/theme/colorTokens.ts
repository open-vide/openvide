import { remoteDevTheme } from "../theme";

export type AppColorMode = "light" | "dark";

export function resolveThemeColors(mode: AppColorMode) {
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
    dimmed: mode === "light" ? "#AEAEB2" : "#6D6860",
    white: "#FFFFFF",
    black: "#000000",
    lightForeground: t.foreground[mode],

    // Status variants
    errorBg: mode === "light" ? "#FEF2F2" : "#3C2824",
    errorLight: "#fca5a5",
    errorBright: "#f87171",
    warningLight: mode === "light" ? "#F5A623" : "#F4C86E",

    // Neutral grays
    neutral: mode === "light" ? "#8E8E93" : "#AAA59C",

    // Tool badge colors (app-specific)
    toolClaude: "#C4704B",
    toolCodex: "#10A37F",
    toolGemini: "#4285F4",

    // Timeout/special
    timeout: "#ea580c",
  } as const;
}

export function resolveThemeCssVariables(mode: AppColorMode): Record<`--${string}`, string> {
  const colors = resolveThemeColors(mode);
  return {
    "--background": colors.background,
    "--foreground": colors.foreground,
    "--card": colors.card,
    "--muted": colors.muted,
    "--muted-foreground": colors.mutedForeground,
    "--primary": colors.primary,
    "--primary-foreground": colors.primaryForeground,
    "--accent": colors.accent,
    "--destructive": colors.destructive,
    "--success": colors.success,
    "--warning": colors.warning,
    "--error": colors.error,
    "--error-bg": colors.errorBg,
    "--info": colors.accent,
    "--border": colors.border,
    "--ring": colors.ring,
    "--dimmed": colors.dimmed,
  };
}
