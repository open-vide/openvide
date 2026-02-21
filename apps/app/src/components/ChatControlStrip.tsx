import React, { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Icon } from "./Icon";
import { cn } from "../lib/utils";
import { useThemeColors } from "../constants/colors";
import { getModelsForTool } from "../core/modelOptions";
import type { AiSession, ToolName } from "../core/types";

interface ChatControlStripProps {
  session: AiSession;
  usagePercent: number;
  hasContext: boolean;
  autoAcceptGlobal: boolean;
  onModelChange: (model: string) => void;
  onAutoAcceptChange: (value: boolean) => void;
}

export function ChatControlStrip({
  session,
  usagePercent,
  hasContext,
  autoAcceptGlobal,
  onModelChange,
  onAutoAcceptChange,
}: ChatControlStripProps): JSX.Element {
  const { accent, mutedForeground } = useThemeColors();
  const [showModelPicker, setShowModelPicker] = useState(false);

  const models = getModelsForTool(session.tool);
  const currentModel = models.find((m) => m.id === session.model) ?? models[0];
  const effectiveAutoAccept = session.autoAccept ?? autoAcceptGlobal;

  return (
    <View className="flex-row items-center gap-1.5">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 6, gap: 8, maxHeight: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Context chip */}
        <View className="flex-row items-center gap-1.5 bg-muted rounded-full px-3 py-1.5">
          <Icon name="pie-chart" size={12} color={mutedForeground} />
          <Text className="text-muted-foreground text-[12px] font-medium">
            {hasContext ? `${Math.round(usagePercent)}% used` : "Context N/A"}
          </Text>
        </View>

        {/* Model chip */}
        <Pressable
          className="flex-row items-center gap-1.5 bg-muted rounded-full px-3 py-1.5 active:opacity-80"
          onPress={() => setShowModelPicker(true)}
        >
          <Icon name="cpu" size={12} color={mutedForeground} />
          <Text className="text-muted-foreground text-[12px] font-medium">
            {currentModel?.label ?? session.model ?? "Default"}
          </Text>
          <Icon name="chevron-down" size={10} color={mutedForeground} />
        </Pressable>

        {/* Auto-accept chip */}
        <Pressable
          className={cn(
            "flex-row items-center gap-1.5 rounded-full px-3 py-1.5 active:opacity-80",
            effectiveAutoAccept ? "bg-warning/15" : "bg-muted",
          )}
          onPress={() => onAutoAcceptChange(!effectiveAutoAccept)}
        >
          <Icon name="zap" size={12} color={effectiveAutoAccept ? "#F5A623" : mutedForeground} />
          <Text className={cn(
            "text-[12px] font-medium",
            effectiveAutoAccept ? "text-warning" : "text-muted-foreground",
          )}>
            Auto-accept
          </Text>
        </Pressable>
      </ScrollView>

      {/* Model picker modal */}
      <Modal
        visible={showModelPicker}
        animationType="fade"
        transparent
        onRequestClose={() => setShowModelPicker(false)}
      >
        <Pressable
          className="flex-1 bg-black/50 justify-end"
          onPress={() => setShowModelPicker(false)}
        >
          <Pressable className="bg-card rounded-t-3xl pb-10 pt-4 px-4" onPress={() => { }}>
            <Text className="text-foreground text-base font-bold text-center mb-3">
              Select Model
            </Text>
            {models.map((m) => {
              const selected = m.id === (session.model ?? currentModel?.id);
              return (
                <Pressable
                  key={m.id}
                  className={cn(
                    "flex-row items-center justify-between py-3.5 px-4 rounded-xl mb-1 active:opacity-80",
                    selected ? "bg-accent/10" : "bg-muted",
                  )}
                  onPress={() => {
                    onModelChange(m.id);
                    setShowModelPicker(false);
                  }}
                >
                  <Text className={cn(
                    "text-[15px] font-semibold",
                    selected ? "text-accent" : "text-foreground",
                  )}>
                    {m.label}
                  </Text>
                  {selected && <Icon name="check" size={18} color={accent} />}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
