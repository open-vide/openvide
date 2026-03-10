import type { ThemeFamily, AppColorMode, ThemeId } from "./themeTypes";
import { themeIdToFamily, themeIdToMode } from "./themeTypes";

export interface ThemeColors {
  background: string;
  foreground: string;
  card: string;
  muted: string;
  mutedForeground: string;
  primary: string;
  primaryForeground: string;
  destructive: string;
  success: string;
  warning: string;
  error: string;
  border: string;
  ring: string;
  accent: string;
  headerBg: string;
  pressedPrimary: string;
  dimmed: string;
  white: string;
  black: string;
  lightForeground: string;
  errorBg: string;
  errorLight: string;
  errorBright: string;
  warningLight: string;
  neutral: string;
  toolClaude: string;
  toolCodex: string;
  toolGemini: string;
  timeout: string;
}

// ---------------------------------------------------------------------------
// Default (green) palette
// ---------------------------------------------------------------------------

const defaultLight: ThemeColors = {
  background: "#FFFFFF",
  foreground: "#1A1A1A",
  card: "#F5F5F5",
  muted: "#F0F0F0",
  mutedForeground: "#8E8E93",
  primary: "#1A1A1A",
  primaryForeground: "#FFFFFF",
  destructive: "#E74C3C",
  success: "#34C759",
  warning: "#F5A623",
  error: "#E74C3C",
  border: "#E5E5EA",
  ring: "#2EAD56",
  accent: "#2EAD56",
  headerBg: "#FFFFFF",
  pressedPrimary: "#3A3A3C",
  dimmed: "#AEAEB2",
  white: "#FFFFFF",
  black: "#000000",
  lightForeground: "#1A1A1A",
  errorBg: "#FEF2F2",
  errorLight: "#fca5a5",
  errorBright: "#f87171",
  warningLight: "#F5A623",
  neutral: "#8E8E93",
  toolClaude: "#C4704B",
  toolCodex: "#10A37F",
  toolGemini: "#4285F4",
  timeout: "#ea580c",
};

const defaultDark: ThemeColors = {
  background: "#1E1E1E",
  foreground: "#F5F5F7",
  card: "#2C2C2E",
  muted: "#3A3A3C",
  mutedForeground: "#8E8E93",
  primary: "#F5F5F7",
  primaryForeground: "#1E1E1E",
  destructive: "#FF6E5F",
  success: "#45D08C",
  warning: "#F4C86E",
  error: "#FF6E5F",
  border: "#3A3A3C",
  ring: "#2EAD56",
  accent: "#2EAD56",
  headerBg: "#1E1E1E",
  pressedPrimary: "#636366",
  dimmed: "#636366",
  white: "#FFFFFF",
  black: "#000000",
  lightForeground: "#F5F5F7",
  errorBg: "#3C2824",
  errorLight: "#fca5a5",
  errorBright: "#f87171",
  warningLight: "#F4C86E",
  neutral: "#8E8E93",
  toolClaude: "#C4704B",
  toolCodex: "#10A37F",
  toolGemini: "#4285F4",
  timeout: "#ea580c",
};

// ---------------------------------------------------------------------------
// Claude (terracotta) palette — matches the existing theme
// ---------------------------------------------------------------------------

const claudeLight: ThemeColors = {
  background: "#FAF7F2",
  foreground: "#1A1A1A",
  card: "#FFFFFF",
  muted: "#F0EDE8",
  mutedForeground: "#8E8E93",
  primary: "#1A1A1A",
  primaryForeground: "#FFFFFF",
  destructive: "#E74C3C",
  success: "#34C759",
  warning: "#F5A623",
  error: "#E74C3C",
  border: "#E5E2DD",
  ring: "#C4704B",
  accent: "#C4704B",
  headerBg: "#FAF7F2",
  pressedPrimary: "#3A3A3C",
  dimmed: "#AEAEB2",
  white: "#FFFFFF",
  black: "#000000",
  lightForeground: "#1A1A1A",
  errorBg: "#FEF2F2",
  errorLight: "#fca5a5",
  errorBright: "#f87171",
  warningLight: "#F5A623",
  neutral: "#8E8E93",
  toolClaude: "#C4704B",
  toolCodex: "#10A37F",
  toolGemini: "#4285F4",
  timeout: "#ea580c",
};

const claudeDark: ThemeColors = {
  background: "#171614",
  foreground: "#F2EEE8",
  card: "#23211F",
  muted: "#2E2B28",
  mutedForeground: "#AAA59C",
  primary: "#F2EEE8",
  primaryForeground: "#171614",
  destructive: "#FF6E5F",
  success: "#45D08C",
  warning: "#F4C86E",
  error: "#FF6E5F",
  border: "#4A4640",
  ring: "#D4836B",
  accent: "#D4836B",
  headerBg: "#171614",
  pressedPrimary: "#636366",
  dimmed: "#6D6860",
  white: "#FFFFFF",
  black: "#000000",
  lightForeground: "#F2EEE8",
  errorBg: "#3C2824",
  errorLight: "#fca5a5",
  errorBright: "#f87171",
  warningLight: "#F4C86E",
  neutral: "#AAA59C",
  toolClaude: "#C4704B",
  toolCodex: "#10A37F",
  toolGemini: "#4285F4",
  timeout: "#ea580c",
};

// ---------------------------------------------------------------------------
// Codex (monochrome) palette
// ---------------------------------------------------------------------------

const codexLight: ThemeColors = {
  background: "#FFFFFF",
  foreground: "#000000",
  card: "#F7F7F7",
  muted: "#EFEFEF",
  mutedForeground: "#6B6B6B",
  primary: "#000000",
  primaryForeground: "#FFFFFF",
  destructive: "#E74C3C",
  success: "#34C759",
  warning: "#F5A623",
  error: "#E74C3C",
  border: "#E0E0E0",
  ring: "#000000",
  accent: "#000000",
  headerBg: "#FFFFFF",
  pressedPrimary: "#3A3A3C",
  dimmed: "#AEAEB2",
  white: "#FFFFFF",
  black: "#000000",
  lightForeground: "#000000",
  errorBg: "#FEF2F2",
  errorLight: "#fca5a5",
  errorBright: "#f87171",
  warningLight: "#F5A623",
  neutral: "#6B6B6B",
  toolClaude: "#C4704B",
  toolCodex: "#10A37F",
  toolGemini: "#4285F4",
  timeout: "#ea580c",
};

const codexDark: ThemeColors = {
  background: "#1E1E1E",
  foreground: "#FFFFFF",
  card: "#2A2A2A",
  muted: "#333333",
  mutedForeground: "#999999",
  primary: "#FFFFFF",
  primaryForeground: "#1E1E1E",
  destructive: "#FF6E5F",
  success: "#45D08C",
  warning: "#F4C86E",
  error: "#FF6E5F",
  border: "#444444",
  ring: "#FFFFFF",
  accent: "#FFFFFF",
  headerBg: "#1E1E1E",
  pressedPrimary: "#636366",
  dimmed: "#666666",
  white: "#FFFFFF",
  black: "#000000",
  lightForeground: "#FFFFFF",
  errorBg: "#3C2824",
  errorLight: "#fca5a5",
  errorBright: "#f87171",
  warningLight: "#F4C86E",
  neutral: "#999999",
  toolClaude: "#C4704B",
  toolCodex: "#10A37F",
  toolGemini: "#4285F4",
  timeout: "#ea580c",
};

// ---------------------------------------------------------------------------
// Palette lookup
// ---------------------------------------------------------------------------

const palettes: Record<ThemeFamily, Record<AppColorMode, ThemeColors>> = {
  default: { light: defaultLight, dark: defaultDark },
  claude: { light: claudeLight, dark: claudeDark },
  codex: { light: codexLight, dark: codexDark },
};

export function getPalette(family: ThemeFamily, mode: AppColorMode): ThemeColors {
  return palettes[family][mode];
}

export function getThemePalette(themeId: ThemeId): ThemeColors {
  return getPalette(themeIdToFamily(themeId), themeIdToMode(themeId));
}

// ---------------------------------------------------------------------------
// Theme metadata for picker UI (6 flat themes)
// ---------------------------------------------------------------------------

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  previewAccent: string;
  previewBg: string;
  isDark: boolean;
}

export const THEME_META: ThemeMeta[] = [
  { id: "default-light", label: "Emerald Light", previewAccent: "#2EAD56", previewBg: "#FFFFFF", isDark: false },
  { id: "default-dark", label: "Emerald Dark", previewAccent: "#2EAD56", previewBg: "#1E1E1E", isDark: true },
  { id: "claude-light", label: "Terracotta Light", previewAccent: "#C4704B", previewBg: "#FAF7F2", isDark: false },
  { id: "claude-dark", label: "Terracotta Dark", previewAccent: "#D4836B", previewBg: "#171614", isDark: true },
  { id: "codex-light", label: "Mono Light", previewAccent: "#000000", previewBg: "#FFFFFF", isDark: false },
  { id: "codex-dark", label: "Mono Dark", previewAccent: "#FFFFFF", previewBg: "#1E1E1E", isDark: true },
];

// ---------------------------------------------------------------------------
// Alternate icon name for a given ThemeId
// ---------------------------------------------------------------------------

const FAMILY_LABEL: Record<ThemeFamily, string> = {
  default: "Default",
  claude: "Claude",
  codex: "Codex",
};

export function getAlternateIconName(themeId: ThemeId): string {
  const family = themeIdToFamily(themeId);
  const mode = themeIdToMode(themeId);
  return `${FAMILY_LABEL[family]}${mode === "dark" ? "Dark" : "Light"}`;
}
