import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, use, useCallback, useEffect, useMemo, useState } from "react";
import { useColorScheme as useSystemColorScheme, View } from "react-native";
import { useColorScheme } from "nativewind";
import { vars } from "react-native-css-interop";
import type { AppColorMode } from "./colorTokens";
import { resolveThemeCssVariables } from "./colorTokens";
import { setResolvedThemeMode } from "./themeRuntime";

const STORAGE_KEY = "open-vide/theme-preference";

export type ThemePreference = "system" | "light" | "dark";

interface AppThemeContextValue {
  themePreference: ThemePreference;
  resolvedMode: AppColorMode;
  setThemePreference: (preference: ThemePreference) => void;
}

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

function isThemePreference(value: string): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function AppThemeProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const { setColorScheme } = useColorScheme();
  const systemColorScheme = useSystemColorScheme();
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (cancelled) return;
        const pref = raw && isThemePreference(raw) ? raw : "system";
        setThemePreferenceState(pref);
        try { setColorScheme(pref); } catch {}
      } catch {
        if (cancelled) return;
        setThemePreferenceState("system");
        try { setColorScheme("system"); } catch {}
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setColorScheme]);

  const setThemePreference = useCallback((preference: ThemePreference) => {
    setThemePreferenceState(preference);
    try {
      setColorScheme(preference);
    } catch {
      // failed to apply theme — no-op
    }
    AsyncStorage.setItem(STORAGE_KEY, preference).catch(() => {});
  }, [setColorScheme]);

  const resolvedMode: AppColorMode = themePreference === "system"
    ? (systemColorScheme === "dark" ? "dark" : "light")
    : themePreference;

  useEffect(() => {
    setResolvedThemeMode(resolvedMode);
  }, [resolvedMode]);
  const variableStyle = useMemo(
    () => vars(resolveThemeCssVariables(resolvedMode)),
    [resolvedMode],
  );

  const value = useMemo<AppThemeContextValue>(() => ({
    themePreference,
    resolvedMode,
    setThemePreference,
  }), [themePreference, resolvedMode, setThemePreference]);

  return (
    <AppThemeContext value={value}>
      <View className={resolvedMode === "dark" ? "flex-1 dark" : "flex-1"} style={variableStyle}>
        {children}
      </View>
    </AppThemeContext>
  );
}

export function useAppTheme(): AppThemeContextValue {
  const value = use(AppThemeContext);
  if (!value) {
    throw new Error("useAppTheme must be used within AppThemeProvider");
  }
  return value;
}
