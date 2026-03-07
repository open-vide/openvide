import React, { useCallback } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { GlassContainer } from "./GlassContainer";
import { Icon } from "./Icon";
import { getModelsForTool, type ModelOption } from "../core/modelOptions";
import type { ToolName } from "../core/types";

interface ModelPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  tool: ToolName;
  selectedModelId: string | undefined;
  onSelectModel: (modelId: string) => void;
  models?: ModelOption[];
}

export function ModelPickerSheet({
  visible,
  onClose,
  tool,
  selectedModelId,
  onSelectModel,
  models,
}: ModelPickerSheetProps): JSX.Element {
  const availableModels = (models && models.length > 0
    ? models.filter((model) => model.tool === tool)
    : getModelsForTool(tool));

  const handleSelect = useCallback(
    (modelId: string) => {
      onSelectModel(modelId);
      onClose();
    },
    [onSelectModel, onClose],
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end">
        <Pressable className="absolute inset-0" onPress={onClose} />
        <GlassContainer variant="sheet" className="p-4 min-h-[200px]">
          <View className="gap-1">
            <Text className="text-foreground text-[15px] font-bold mb-2">Select Model</Text>
            {availableModels.map((model) => {
              const isSelected = model.id === selectedModelId;
              return (
                <Pressable
                  key={model.id}
                  onPress={() => handleSelect(model.id)}
                  className="flex-row items-center justify-between py-3 px-2 rounded-xl active:opacity-80"
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text
                    className={isSelected ? "text-accent text-[15px] font-semibold" : "text-foreground text-[15px]"}
                  >
                    {model.label}
                  </Text>
                  {isSelected && <Icon name="check" size={18} color="#6366f1" />}
                </Pressable>
              );
            })}
          </View>
        </GlassContainer>
      </View>
    </Modal>
  );
}
