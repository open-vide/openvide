import React, { createContext, use, useCallback, useMemo, useState } from "react";
import { useSharedValue, withSpring, type SharedValue } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

export type SidebarSection = "sessions" | "hosts" | "settings";

const SPRING_CONFIG = { damping: 18, stiffness: 200, mass: 0.7 };

interface SidebarContextValue {
  drawerProgress: SharedValue<number>;
  isOpen: boolean;
  isAtRoot: boolean;
  setIsAtRoot: (value: boolean) => void;
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;
  activeSection: SidebarSection;
  setActiveSection: (section: SidebarSection) => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const drawerProgress = useSharedValue(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isAtRoot, setIsAtRoot] = useState(true);
  const [activeSection, setActiveSection] = useState<SidebarSection>("sessions");

  const openSidebar = useCallback(() => {
    setIsOpen(true);
    drawerProgress.value = withSpring(1, SPRING_CONFIG);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [drawerProgress]);

  const closeSidebar = useCallback(() => {
    setIsOpen(false);
    drawerProgress.value = withSpring(0, SPRING_CONFIG);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [drawerProgress]);

  const toggleSidebar = useCallback(() => {
    if (isOpen) {
      closeSidebar();
    } else {
      openSidebar();
    }
  }, [isOpen, openSidebar, closeSidebar]);

  const value = useMemo<SidebarContextValue>(
    () => ({
      drawerProgress,
      isOpen,
      isAtRoot,
      setIsAtRoot,
      openSidebar,
      closeSidebar,
      toggleSidebar,
      activeSection,
      setActiveSection,
    }),
    [drawerProgress, isOpen, isAtRoot, openSidebar, closeSidebar, toggleSidebar, activeSection],
  );

  return <SidebarContext value={value}>{children}</SidebarContext>;
}

export function useSidebar(): SidebarContextValue {
  const ctx = use(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}
