// ---------------------------------------------------------------------------
// Platform-agnostic design tokens — single source of truth
// ---------------------------------------------------------------------------

type ColorValue = { light: string; dark: string };

export const baseTheme = {
  colors: {
    // Surfaces
    background: { light: "#FAF7F2", dark: "#1C1C1E" },
    foreground: { light: "#1A1A1A", dark: "#F5F5F7" },
    card: { light: "#FFFFFF", dark: "#2C2C2E" },
    muted: { light: "#F0EDE8", dark: "#3A3A3C" },
    mutedForeground: { light: "#8E8E93", dark: "#8E8E93" },
    // Interactive
    primary: { light: "#1A1A1A", dark: "#F5F5F7" },
    primaryForeground: { light: "#FFFFFF", dark: "#1C1C1E" },
    secondary: { light: "#F0EDE8", dark: "#3A3A3C" },
    secondaryForeground: { light: "#1A1A1A", dark: "#F5F5F7" },
    destructive: { light: "#E74C3C", dark: "#FF453A" },
    destructiveForeground: { light: "#FFFFFF", dark: "#1C1C1E" },
    // Feedback
    success: { light: "#34C759", dark: "#30D158" },
    warning: { light: "#F5A623", dark: "#FFD60A" },
    error: { light: "#E74C3C", dark: "#FF453A" },
    info: { light: "#C4704B", dark: "#D4836B" },
    // Borders
    border: { light: "#E5E2DD", dark: "#3A3A3C" },
    ring: { light: "#C4704B", dark: "#D4836B" },
  },
  typography: {
    fontFamily: { web: "Inter, system-ui, sans-serif", native: "System" },
    sizes: {
      xs: { fontSize: 12, lineHeight: 16 },
      sm: { fontSize: 14, lineHeight: 20 },
      base: { fontSize: 16, lineHeight: 24 },
      lg: { fontSize: 18, lineHeight: 28 },
      xl: { fontSize: 20, lineHeight: 28 },
      "2xl": { fontSize: 24, lineHeight: 32 },
      "3xl": { fontSize: 30, lineHeight: 36 },
      "4xl": { fontSize: 36, lineHeight: 40 },
    },
    weights: { regular: "400", medium: "500", semibold: "600", bold: "700" },
  },
  spacing: {
    0.5: 2,
    1: 4,
    1.5: 6,
    2: 8,
    3: 12,
    4: 16,
    5: 20,
    6: 24,
    8: 32,
    10: 40,
    12: 48,
    16: 64,
  },
  borderRadius: { sm: 4, md: 8, lg: 12, xl: 16, full: 9999 },
} as const;

export type Theme = typeof baseTheme;

// ---------------------------------------------------------------------------
// DeepPartial utility
// ---------------------------------------------------------------------------

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends string
    ? string
    : T[P] extends number
      ? number
      : T[P] extends object
        ? DeepPartial<T[P]>
        : T[P];
};

// ---------------------------------------------------------------------------
// Theme creation
// ---------------------------------------------------------------------------

function deepMerge<T extends Record<string, unknown>>(base: T, overrides: DeepPartial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(overrides) as (keyof T)[]) {
    const overrideVal = overrides[key];
    if (overrideVal === undefined) continue;
    const baseVal = base[key];
    if (
      baseVal &&
      typeof baseVal === "object" &&
      !Array.isArray(baseVal) &&
      typeof overrideVal === "object" &&
      !Array.isArray(overrideVal)
    ) {
      result[key] = deepMerge(baseVal as Record<string, unknown>, overrideVal as Record<string, unknown>) as T[keyof T];
    } else {
      result[key] = overrideVal as T[keyof T];
    }
  }
  return result;
}

/** Create project-specific theme by merging overrides with base */
export function createTheme(overrides: DeepPartial<Theme>): Theme {
  return deepMerge(baseTheme, overrides) as Theme;
}

// ---------------------------------------------------------------------------
// Color resolution
// ---------------------------------------------------------------------------

/** Get resolved color for current mode */
export function resolveColor(token: ColorValue, mode: "light" | "dark"): string {
  return token[mode];
}

/** Resolve all colors in a theme for a given mode */
export function resolveColors(theme: Theme, mode: "light" | "dark"): Record<string, string> {
  return Object.fromEntries(
    Object.entries(theme.colors).map(([key, val]) => [key, val[mode]]),
  );
}
