import { useAppTheme, type ThemePreference } from "../theme/AppThemeProvider";
import { resolveThemeColors } from "../theme/colorTokens";
import { getResolvedThemeMode } from "../theme/themeRuntime";

type ThemeColorMap = ReturnType<typeof resolveThemeColors>;

/** Backward-compatible color object for non-hook contexts. */
export const colors = new Proxy({} as ThemeColorMap, {
  get(_target, prop) {
    if (typeof prop !== "string") return undefined;
    const resolved = resolveThemeColors(getResolvedThemeMode());
    return resolved[prop as keyof ThemeColorMap];
  },
}) as ThemeColorMap;

/** Hook that returns theme-aware colors + scheme controls */
export function useThemeColors() {
  const { themePreference, resolvedMode, setThemePreference } = useAppTheme();

  const setColorScheme = (scheme: ThemePreference) => {
    setThemePreference(scheme);
  };

  const toggleColorScheme = () => {
    setThemePreference(resolvedMode === "dark" ? "light" : "dark");
  };

  return {
    ...resolveThemeColors(resolvedMode),
    colorScheme: themePreference,
    resolvedColorScheme: resolvedMode,
    setColorScheme,
    toggleColorScheme,
  };
}
