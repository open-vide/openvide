import React, { createContext, use, useCallback, useEffect, useState } from "react";
import { Platform, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { cn } from "../lib/utils";

// ---------------------------------------------------------------------------
// Glass availability detection
// ---------------------------------------------------------------------------

let _glassApiAvailable: boolean | null = null;

function checkGlassApi(): boolean {
  if (_glassApiAvailable !== null) return _glassApiAvailable;
  if (Platform.OS !== "ios") {
    _glassApiAvailable = false;
    return false;
  }
  try {
    const mod = require("expo-glass-effect");
    _glassApiAvailable = typeof mod.isGlassEffectAPIAvailable === "function" && mod.isGlassEffectAPIAvailable() === true;
  } catch {
    _glassApiAvailable = false;
  }
  return _glassApiAvailable ?? false;
}

// ---------------------------------------------------------------------------
// Context: glass user preference
// ---------------------------------------------------------------------------

const STORAGE_KEY = "glassEnabled";

interface GlassContextValue {
  glassEnabled: boolean;
  setGlassEnabled: (enabled: boolean) => void;
  glassSupported: boolean;
}

const GlassContext = createContext<GlassContextValue>({
  glassEnabled: false,
  setGlassEnabled: () => {},
  glassSupported: false,
});

export function GlassProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const glassSupported = checkGlassApi();
  const [glassEnabled, setGlassEnabledState] = useState(false);

  useEffect(() => {
    if (!glassSupported) return;
    AsyncStorage.getItem(STORAGE_KEY).then((val) => {
      if (val === "true") setGlassEnabledState(true);
    });
  }, [glassSupported]);

  const setGlassEnabled = useCallback((enabled: boolean) => {
    setGlassEnabledState(enabled);
    AsyncStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  }, []);

  return (
    <GlassContext value={{ glassEnabled: glassSupported && glassEnabled, setGlassEnabled, glassSupported }}>
      {children}
    </GlassContext>
  );
}

export function useGlassEnabled(): GlassContextValue {
  return use(GlassContext);
}

// ---------------------------------------------------------------------------
// Variant styles
// ---------------------------------------------------------------------------

type GlassVariant = "card" | "surface" | "pill" | "sheet" | "fab" | "nav";

const VARIANT_CLASSES: Record<GlassVariant, { fallback: string; glass: string }> = {
  card: {
    fallback: "bg-card rounded-2xl border border-border overflow-hidden",
    glass: "rounded-2xl overflow-hidden",
  },
  surface: {
    fallback: "bg-card border-t border-border",
    glass: "border-t border-border/20",
  },
  pill: {
    fallback: "",
    glass: "",
  },
  sheet: {
    fallback: "bg-card rounded-t-[24px] border-t border-border",
    glass: "rounded-t-[24px]",
  },
  fab: {
    fallback: "bg-accent rounded-full shadow-lg",
    glass: "rounded-full shadow-lg",
  },
  nav: {
    fallback: "",
    glass: "",
  },
};

// ---------------------------------------------------------------------------
// GlassContainer component
// ---------------------------------------------------------------------------

interface GlassContainerProps {
  variant: GlassVariant;
  className?: string;
  children: React.ReactNode;
  forceOpaque?: boolean;
}

export function GlassContainer({
  variant,
  className,
  children,
  forceOpaque = false,
}: GlassContainerProps): JSX.Element {
  const { glassEnabled } = useGlassEnabled();
  const useGlass = glassEnabled && !forceOpaque;
  const variantConfig = VARIANT_CLASSES[variant];

  if (useGlass) {
    try {
      const { GlassView } = require("expo-glass-effect");
      return (
        <View className={cn(variantConfig.glass, className)}>
          <GlassView
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
            glassEffectStyle="regular"
          />
          {children}
        </View>
      );
    } catch {
      // Fall through to opaque
    }
  }

  return (
    <View className={cn(variantConfig.fallback, className)}>
      {children}
    </View>
  );
}
