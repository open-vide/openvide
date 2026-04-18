import React from "react";
import { Image, Text, View } from "react-native";
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
} as const satisfies Partial<Record<string, { light: number; dark: number }>>;

type Props = {
  tool: string;
  size?: number;
};

export function ProviderIcon({ tool, size = 24 }: Props): JSX.Element {
  const { colorScheme } = useColorScheme();
  const variant = colorScheme === "dark" ? "dark" : "light";
  const circleSize = Math.round(size * 1.6);
  const iconSize = Math.round(size * 1.0);
  const source = icons[tool as keyof typeof icons]?.[variant];
  const fallbackLabel = tool.slice(0, 1).toUpperCase() || "?";

  return (
    <View
      className="bg-muted rounded-full items-center justify-center overflow-hidden"
      style={{ width: circleSize, height: circleSize }}
    >
      {source ? (
        <Image source={source} style={{ width: iconSize, height: iconSize, borderRadius: iconSize / 2 }} />
      ) : (
        <Text className="text-foreground font-semibold" style={{ fontSize: Math.round(size * 0.72) }}>
          {fallbackLabel}
        </Text>
      )}
    </View>
  );
}
