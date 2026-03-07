import React from "react";
import { Text, View } from "react-native";
import { useThemeColors } from "../constants/colors";
import { GlassContainer } from "./GlassContainer";
import { Icon, type FeatherIconName } from "./Icon";
import { StreamingDots } from "./StreamingDots";

type ActivityStatus = "running" | "completed" | "error";

export function ToolActivityRow({
  icon,
  label,
  status,
}: {
  icon: FeatherIconName;
  label: string;
  status?: ActivityStatus;
}): JSX.Element {
  const colors = useThemeColors();

  return (
    <GlassContainer variant="card" className="overflow-hidden">
      <View className="flex-row items-center justify-between gap-3 px-3.5 py-3">
        <View className="flex-row items-center gap-2.5 shrink">
          <View
            className="w-7 h-7 rounded-full items-center justify-center"
            style={{ backgroundColor: `${colors.accent}18` }}
          >
            <Icon name={icon} size={14} color={colors.accent} />
          </View>
          <Text selectable className="text-foreground text-[14px] font-medium shrink">
            {label}
          </Text>
        </View>

        {status === "running" ? (
          <StreamingDots />
        ) : status === "completed" ? (
          <Icon name="check" size={14} color={colors.success} />
        ) : status === "error" ? (
          <Icon name="alert-circle" size={14} color={colors.destructive} />
        ) : null}
      </View>
    </GlassContainer>
  );
}
