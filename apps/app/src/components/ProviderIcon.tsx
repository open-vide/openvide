import React from "react";
import { Image, View } from "react-native";
import { useColorScheme } from "nativewind";

const icons = {
  claude: {
    light: require("../../assets/claude_light.png"),
    dark: require("../../assets/claude_dark.png"),
  },
  codex: {
    light: require("../../assets/openai_light.png"),
    dark: require("../../assets/openai_dark.png"),
  },
} as const;

type Props = {
  tool: "claude" | "codex";
  size?: number;
};

export function ProviderIcon({ tool, size = 24 }: Props): JSX.Element {
  const { colorScheme } = useColorScheme();
  const variant = colorScheme === "dark" ? "dark" : "light";
  const source = icons[tool][variant];
  const circleSize = Math.round(size * 1.6);
  const iconSize = Math.round(size * 1.0);

  return (
    <View
      className="bg-muted rounded-full items-center justify-center overflow-hidden"
      style={{ width: circleSize, height: circleSize }}
    >
      <Image source={source} style={{ width: iconSize, height: iconSize, borderRadius: iconSize / 2 }} />
    </View>
  );
}
