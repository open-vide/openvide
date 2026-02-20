import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { AiSessionStatus, ToolName } from "../core/types";
import { useAppStore } from "../state/AppStoreContext";
import { cn } from "../lib/utils";

export function QuickActions({
  sessionStatus,
  tool,
  onAction,
  onOpenLibrary,
}: {
  sessionStatus: AiSessionStatus;
  tool?: ToolName;
  onAction: (text: string) => void;
  onOpenLibrary?: () => void;
}): JSX.Element | null {
  const { promptTemplates } = useAppStore();

  if (sessionStatus === "running") return null;

  const filtered = promptTemplates.filter((t) => {
    if (t.toolFilter && t.toolFilter.length > 0 && tool && !t.toolFilter.includes(tool)) {
      return false;
    }
    if (t.statusFilter && t.statusFilter.length > 0 && !t.statusFilter.includes(sessionStatus)) {
      return false;
    }
    return true;
  });

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}
        keyboardShouldPersistTaps="handled"
      >
        {filtered.map((template) => (
          <Pressable
            key={template.id}
            className="h-8 rounded-full border border-border bg-card px-3.5 justify-center items-center active:opacity-70"
            onPress={() => onAction(template.prompt)}
            accessibilityRole="button"
            accessibilityLabel={template.label}
          >
            <Text className="text-foreground text-[13px] font-medium">
              {template.icon ? `${template.icon} ` : ""}{template.label}
            </Text>
          </Pressable>
        ))}
        {onOpenLibrary && (
          <Pressable
            className="h-8 rounded-full border border-border bg-card px-3 justify-center items-center active:opacity-70"
            onPress={onOpenLibrary}
            accessibilityRole="button"
            accessibilityLabel="Open prompt library"
          >
            <Text className="text-muted-foreground text-[13px] font-medium">+</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}
