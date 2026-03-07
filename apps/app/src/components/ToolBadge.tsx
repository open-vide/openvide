import React from "react";
import { Text, View } from "react-native";
import { cn } from "../lib/utils";
import type { ToolName } from "../core/types";

const TOOL_BG_CLASSES: Record<ToolName, string> = {
  claude: "bg-tool-claude",
  codex: "bg-tool-codex",
  gemini: "bg-tool-gemini",
};

export function ToolBadge({ tool }: { tool: ToolName }): JSX.Element {
  return (
    <View className={cn("self-start rounded-full px-2.5 py-[3px]", TOOL_BG_CLASSES[tool])}>
      <Text className="text-white font-bold text-xs capitalize">{tool}</Text>
    </View>
  );
}
