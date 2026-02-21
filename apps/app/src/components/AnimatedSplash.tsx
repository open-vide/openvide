import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import LottieView from "lottie-react-native";

SplashScreen.preventAutoHideAsync();

const SPLASH_BG = "#1E1E1E";
const SAFETY_TIMEOUT = 6000;
const MIN_DISPLAY_MS = 1800;
const FADE_OUT_MS = 300;

interface Props {
  children: React.ReactNode;
}

export function AnimatedSplash({ children }: Props): JSX.Element {
  const [overlayReady, setOverlayReady] = useState(false);
  const [animationStarted, setAnimationStarted] = useState(false);
  const [hidden, setHidden] = useState(false);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const startTime = useRef(0);
  const hasFinished = useRef(false);

  // Once overlay is laid out and painted, hide the native splash.
  // Only start the Lottie after hideAsync resolves (native splash
  // fully gone), so the animation plays from frame 0 on screen.
  const onOverlayLayout = useCallback(() => {
    if (overlayReady) return;
    setOverlayReady(true);
    SplashScreen.hideAsync().then(() => {
      startTime.current = Date.now();
      setAnimationStarted(true);
    });
  }, [overlayReady]);

  // Smooth fade-out then unmount overlay
  const fadeOut = useCallback(() => {
    if (hasFinished.current) return;
    hasFinished.current = true;
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: FADE_OUT_MS,
      useNativeDriver: true,
    }).start(() => setHidden(true));
  }, [fadeAnim]);

  // When Lottie finishes, enforce minimum display time to prevent
  // the animation from being cut short (e.g. if FaceID's system
  // overlay paused the animation and it reported "finished" early).
  const onAnimationFinish = useCallback(() => {
    const elapsed = Date.now() - startTime.current;
    const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);
    setTimeout(fadeOut, remaining);
  }, [fadeOut]);

  // Safety timeout in case onAnimationFinish never fires
  useEffect(() => {
    if (!animationStarted) return;
    const timer = setTimeout(fadeOut, SAFETY_TIMEOUT);
    return () => clearTimeout(timer);
  }, [animationStarted, fadeOut]);

  return (
    <View style={styles.flex}>
      {children}
      {!hidden && (
        <Animated.View
          style={[styles.overlay, { opacity: fadeAnim }]}
          onLayout={onOverlayLayout}
        >
          {animationStarted && (
            <LottieView
              source={require("../../assets/splash-animation.json")}
              autoPlay
              loop={false}
              speed={2}
              onAnimationFinish={onAnimationFinish}
              style={styles.lottie}
              resizeMode="contain"
            />
          )}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: SPLASH_BG,
  },
  lottie: {
    flex: 1,
  },
});
