import React from "react";
import { Pressable, Text, View } from "react-native";
import { Icon, type FeatherIconName } from "./Icon";
import { colors } from "../constants/colors";

export function EmptyState({
  icon,
  message,
  actionLabel,
  onAction,
}: {
  icon: FeatherIconName;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}): JSX.Element {
  return (
    <View className="flex-1 items-center justify-center px-8 py-12 gap-3">
      <View className="mb-1">
        <Icon name={icon} size={40} color={colors.dimmed} />
      </View>
      <Text className="text-muted-foreground text-[15px] text-center leading-[22px]">{message}</Text>
      {actionLabel != null && onAction != null && (
        <Pressable className="mt-2 bg-accent rounded-full px-8 py-4 active:opacity-80" onPress={onAction}>
          <Text className="text-white font-bold text-[15px]">{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}
