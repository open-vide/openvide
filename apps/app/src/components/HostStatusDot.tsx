import React, { useEffect, useRef } from "react";
import { Animated, View } from "react-native";
import { cn } from "../lib/utils";

const STATUS_BG: Record<"unknown" | "connected" | "failed", string> = {
  connected: "bg-success",
  failed: "bg-destructive",
  unknown: "bg-neutral",
};

export function HostStatusDot({
  status,
  loading = false,
}: {
  status: "unknown" | "connected" | "failed";
  loading?: boolean;
}): JSX.Element {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!loading) {
      pulse.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [loading, pulse]);

  if (loading) {
    return (
      <Animated.View
        className="w-2.5 h-2.5 rounded-full bg-accent"
        style={{ opacity: pulse }}
      />
    );
  }

  return (
    <View className={cn("w-2.5 h-2.5 rounded-full", STATUS_BG[status])} />
  );
}
