import React from "react";
import { Pressable, View } from "react-native";
import { useSidebar } from "../navigation/SidebarContext";

export function HamburgerButton(): JSX.Element {
  const { toggleSidebar } = useSidebar();

  return (
    <Pressable
      onPress={toggleSidebar}
      className="w-10 h-10 justify-center items-center"
      hitSlop={8}
    >
      <View className="w-[20px] h-[2px] bg-foreground rounded-full mb-[5px]" />
      <View className="w-[20px] h-[2px] bg-foreground rounded-full mb-[5px]" />
      <View className="w-[20px] h-[2px] bg-foreground rounded-full" />
    </Pressable>
  );
}
