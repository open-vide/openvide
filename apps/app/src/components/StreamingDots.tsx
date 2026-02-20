import React, { useEffect, useRef } from "react";
import { Animated, View } from "react-native";

const DOT_COUNT = 3;
const ANIMATION_DURATION = 600;
const STAGGER_DELAY = 200;

export function StreamingDots(): JSX.Element {
  const opacities = useRef<Animated.Value[]>(
    Array.from({ length: DOT_COUNT }, () => new Animated.Value(0.3)),
  ).current;

  useEffect(() => {
    const animations = opacities.map((opacity, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * STAGGER_DELAY),
          Animated.timing(opacity, {
            toValue: 1,
            duration: ANIMATION_DURATION,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0.3,
            duration: ANIMATION_DURATION,
            useNativeDriver: true,
          }),
        ]),
      ),
    );

    const composite = Animated.parallel(animations);
    composite.start();

    return () => {
      composite.stop();
    };
  }, [opacities]);

  return (
    <View className="flex-row items-center gap-1.5 py-2">
      {opacities.map((opacity, index) => (
        <Animated.View
          key={index}
          className="w-2 h-2 rounded-full bg-dimmed"
          style={{ opacity }}
        />
      ))}
    </View>
  );
}
