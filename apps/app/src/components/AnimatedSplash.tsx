import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import LottieView from "lottie-react-native";

SplashScreen.preventAutoHideAsync();

const SPLASH_BG = "#1E1E1E";
const SAFETY_TIMEOUT = 6000;

interface Props {
  children: React.ReactNode;
}

export function AnimatedSplash({ children }: Props): JSX.Element {
  const [ready, setReady] = useState(false);
  const [finished, setFinished] = useState(false);
  const hasFinished = useRef(false);

  useEffect(() => {
    SplashScreen.hideAsync().then(() => {
      setReady(true);
    });
  }, []);

  const hide = useCallback(() => {
    if (hasFinished.current) return;
    hasFinished.current = true;
    setFinished(true);
  }, []);

  // Safety timeout in case onAnimationFinish doesn't fire
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(hide, SAFETY_TIMEOUT);
    return () => clearTimeout(timer);
  }, [ready, hide]);

  return (
    <View style={styles.flex}>
      {children}
      {!finished && (
        <View style={styles.overlay}>
          {ready && (
            <LottieView
              source={require("../../assets/splash-animation.json")}
              autoPlay
              loop={false}
              speed={2}
              onAnimationFinish={() => setTimeout(hide, 300)}
              style={styles.lottie}
              resizeMode="contain"
            />
          )}
        </View>
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
