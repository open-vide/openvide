import React from "react";
import { Pressable, Text, View } from "react-native";
import { formatRelativeTime } from "../core/formatTime";
import type { TargetProfile, ToolName } from "../core/types";
import { HostStatusDot } from "./HostStatusDot";
import { ToolBadge } from "./ToolBadge";
import { GlassContainer } from "./GlassContainer";

export const HostCard = React.memo(function HostCard({
  target,
  onPress,
}: {
  target: TargetProfile;
  onPress: () => void;
}): JSX.Element {
  const installedTools = target.detectedTools
    ? (Object.entries(target.detectedTools) as [ToolName, { installed: boolean }][])
        .filter(([, info]) => info.installed)
        .map(([name]) => name)
    : [];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={target.label}
      className="active:opacity-70"
    >
      <GlassContainer variant="card" className="p-3.5">
        <View className="flex-row items-center">
          <View className="flex-1 gap-1">
            <Text className="text-foreground text-base font-bold" numberOfLines={1}>
              {target.label}
            </Text>
            <Text className="text-muted-foreground text-[13px] leading-[18px]" numberOfLines={1}>
              {target.username}@{target.host}:{target.port}
            </Text>
            {installedTools.length > 0 && (
              <View className="flex-row gap-1.5 mt-0.5">
                {installedTools.map((tool) => (
                  <ToolBadge key={tool} tool={tool} />
                ))}
              </View>
            )}
            {target.lastSeenAt != null && (
              <Text className="text-dimmed text-xs leading-4">
                {formatRelativeTime(target.lastSeenAt)}
              </Text>
            )}
          </View>
          <View className="ml-3 justify-center items-center">
            <HostStatusDot status={target.lastStatus} loading={target.lastStatus === "unknown"} />
          </View>
        </View>
      </GlassContainer>
    </Pressable>
  );
});
