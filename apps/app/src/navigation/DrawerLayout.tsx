import React, { useCallback } from "react";
import { Dimensions, Pressable, StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { SidebarProvider, useSidebar } from "./SidebarContext";
import { SidebarContent } from "../components/SidebarContent";
import { MainNavigator } from "./MainNavigator";
import { useThemeColors } from "../constants/colors";

const SIDEBAR_WIDTH = 310;
const MAIN_SHIFT = 320;
const MAIN_SCALE = 0.985;
const OVERLAY_OPACITY = 0.45;
const EDGE_WIDTH = 24;
const SPRING_CONFIG = { damping: 24, stiffness: 200, mass: 0.7 };
const SCREEN_WIDTH = Dimensions.get("window").width;


function DrawerInner(): JSX.Element {
  const { drawerProgress, isOpen, openSidebar, closeSidebar } = useSidebar();
  const { background } = useThemeColors();

  const closeDrawer = useCallback(() => {
    closeSidebar();
  }, [closeSidebar]);

  const openDrawer = useCallback(() => {
    openSidebar();
  }, [openSidebar]);

  // Edge pan gesture to open/close
  const pan = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-20, 20])
    .onUpdate((event) => {
      "worklet";
      const progress = Math.max(0, Math.min(1, event.translationX / MAIN_SHIFT));
      if (!isOpen) {
        // Only respond if starting from left edge
        if (event.x - event.translationX < EDGE_WIDTH) {
          drawerProgress.value = progress;
        }
      } else {
        drawerProgress.value = Math.max(0, Math.min(1, 1 + event.translationX / MAIN_SHIFT));
      }
    })
    .onEnd((event) => {
      "worklet";
      const shouldOpen = isOpen
        ? event.translationX > -MAIN_SHIFT / 3
        : event.translationX > MAIN_SHIFT / 3 || event.velocityX > 500;

      drawerProgress.value = withSpring(shouldOpen ? 1 : 0, SPRING_CONFIG);
      if (shouldOpen) {
        runOnJS(openDrawer)();
      } else {
        runOnJS(closeDrawer)();
      }
    });

  // Sidebar fades/slides in underneath the main content
  const sidebarStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(drawerProgress.value, [0, 1], [-SIDEBAR_WIDTH * 0.3, 0]) },
    ],
    opacity: interpolate(drawerProgress.value, [0, 0.3, 1], [0, 0.8, 1]),
    pointerEvents: drawerProgress.value > 0.01 ? ("auto" as const) : ("none" as const),
  }));

  // Main content shifts right and scales down — sits ON TOP of sidebar
  const mainStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(drawerProgress.value, [0, 1], [0, MAIN_SHIFT]) },
      { scale: interpolate(drawerProgress.value, [0, 1], [1, MAIN_SCALE]) },
    ],
    borderRadius: interpolate(drawerProgress.value, [0, 0.1, 1], [0, 16, 16]),
  }));

  // Dark overlay — opacity only, inherits transform from parent main content view
  const overlayOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(drawerProgress.value, [0, 1], [0, OVERLAY_OPACITY]),
    pointerEvents: drawerProgress.value > 0.01 ? ("auto" as const) : ("none" as const),
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.container, { backgroundColor: background }]}>
        {/* Sidebar — rendered FIRST so it's behind the main content */}
        <Animated.View style={[styles.sidebar, sidebarStyle]}>
          <SidebarContent />
        </Animated.View>

        {/* Main content — rendered SECOND so it's on top, slides right to reveal sidebar */}
        <Animated.View style={[styles.main, { backgroundColor: background }, mainStyle]}>
          <MainNavigator />
          {/* Overlay inside main — covers full area */}
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "#000000" }, overlayOpacity]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeSidebar} />
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

export function DrawerLayout(): JSX.Element {
  return (
    <SidebarProvider>
      <DrawerInner />
    </SidebarProvider>
  );
}

// Navigation APIs require style objects — backgroundColor set dynamically in component
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  sidebar: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    width: SIDEBAR_WIDTH,
    overflow: "hidden",
  },
  main: {
    flex: 1,
    overflow: "hidden",
  },
});
