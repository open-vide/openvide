import React from "react";
import { Text, View } from "react-native";
import { cn } from "../lib/utils";
import { GlassContainer, useGlassEnabled } from "./GlassContainer";

const BG_CLASS: Record<string, string> = {
  unknown: "bg-neutral",
  connected: "bg-success",
  failed: "bg-destructive",
  ready: "bg-success",
  partial: "bg-warning",
  blocked: "bg-destructive",
  connecting: "bg-accent",
  running: "bg-accent",
  idle: "bg-success",
  completed: "bg-success",
  cancelled: "bg-warning",
  timeout: "bg-warning",
  installed: "bg-success",
};

export function StatePill({ value }: { value: string }): JSX.Element {
  const { glassEnabled } = useGlassEnabled();

  if (glassEnabled) {
    return (
      <GlassContainer variant="pill" className={cn("self-start rounded-full px-2.5 py-1", BG_CLASS[value] ?? "bg-border")}>
        <Text className="text-white font-semibold text-xs">{value}</Text>
      </GlassContainer>
    );
  }

  return (
    <View className={cn("self-start rounded-full px-2.5 py-1", BG_CLASS[value] ?? "bg-border")}>
      <Text className="text-white font-semibold text-xs">{value}</Text>
    </View>
  );
}
