import React from "react";
import { Pressable, Text, View } from "react-native";
import { Icon } from "./Icon";
import { getModesForTool, getNextMode } from "../core/modeOptions";
import { getModelsForTool, type ModelOption } from "../core/modelOptions";
import type { ToolName } from "../core/types";
import type { ModeOption } from "../core/modeOptions";

interface ChatToolbarProps {
  tool: ToolName;
  mode: string | undefined;
  onModeChange: (mode: string) => void;
  model: string | undefined;
  onModelPress: () => void;
  models?: ModelOption[];
}

const ChatToolbar = React.memo(function ChatToolbar({
  tool,
  mode,
  onModeChange,
  model,
  onModelPress,
  models,
}: ChatToolbarProps): JSX.Element {
  const modes = getModesForTool(tool);
  const hasModes = modes.length > 0;

  const currentMode: ModeOption | undefined = modes.find((m) => m.id === mode) ?? modes[0];

  const modelOptions = models && models.length > 0 ? models : getModelsForTool(tool);
  const currentModelLabel = modelOptions.find((m) => m.id === model)?.label ?? model ?? "Model";

  const handleModePress = () => {
    const next = getNextMode(tool, currentMode?.id);
    if (next) {
      onModeChange(next);
    }
  };

  return (
    <View className="flex-row items-center gap-2 px-4 py-1.5">
      {hasModes && currentMode && (
        <Pressable
          onPress={handleModePress}
          className="flex-row items-center gap-1.5 bg-muted rounded-full px-3 py-1.5 active:opacity-80"
          accessibilityRole="button"
          accessibilityLabel={`Mode: ${currentMode.label}. Tap to cycle.`}
        >
          <Icon name={currentMode.icon} size={14} />
          <Text className="text-foreground text-[13px] font-medium">{currentMode.label}</Text>
        </Pressable>
      )}

      <Pressable
        onPress={onModelPress}
        className="flex-row items-center gap-1.5 bg-muted rounded-full px-3 py-1.5 active:opacity-80"
        accessibilityRole="button"
        accessibilityLabel={`Model: ${currentModelLabel}. Tap to change.`}
      >
        <Icon name="cpu" size={14} />
        <Text className="text-foreground text-[13px] font-medium" numberOfLines={1}>{currentModelLabel}</Text>
      </Pressable>
    </View>
  );
});

export { ChatToolbar };
