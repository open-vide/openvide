import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon } from "./Icon";
import { useThemeColors } from "../constants/colors";
import { GlassContainer } from "./GlassContainer";

export function CollapsibleCard({
  title,
  defaultOpen = false,
  titleRight,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  titleRight?: React.ReactNode;
  children: React.ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const { mutedForeground } = useThemeColors();

  return (
    <GlassContainer variant="card">
      <Pressable
        className="flex-row items-center justify-between px-3.5 py-3"
        onPress={() => setOpen((prev) => !prev)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text className="text-foreground font-semibold text-[15px] shrink">{title}</Text>
        <View className="flex-row items-center gap-2 ml-2">
          {titleRight}
          <Icon name={open ? "chevron-up" : "chevron-down"} size={14} color={mutedForeground} />
        </View>
      </Pressable>
      {open && <View className="px-3.5 pb-3.5">{children}</View>}
    </GlassContainer>
  );
}
