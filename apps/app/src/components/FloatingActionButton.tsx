import React from "react";
import { Pressable, View } from "react-native";
import { Icon } from "./Icon";
import { GlassContainer, useGlassEnabled } from "./GlassContainer";

export function FloatingActionButton({
  onPress,
}: {
  onPress: () => void;
}): JSX.Element {
  const { glassEnabled } = useGlassEnabled();

  return (
    <View className="absolute bottom-6 right-6">
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Create new"
        className="active:opacity-80"
      >
        <GlassContainer
          variant="fab"
          className={glassEnabled ? "w-14 h-14 items-center justify-center" : "w-14 h-14 items-center justify-center"}
          forceOpaque={false}
        >
          <Icon name="plus" size={24} color="#FFFFFF" />
        </GlassContainer>
      </Pressable>
    </View>
  );
}
