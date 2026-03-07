import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Icon } from "./Icon";
import { useThemeColors } from "../constants/colors";
import type { Attachment } from "../core/attachmentHandler";
import { canInline } from "../core/attachmentHandler";

interface AttachmentPreviewProps {
  attachments: Attachment[];
  onRemove: (id: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function AttachmentPreview({ attachments, onRemove }: AttachmentPreviewProps): JSX.Element | null {
  const { mutedForeground, accent } = useThemeColors();

  if (attachments.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}
      keyboardShouldPersistTaps="handled"
    >
      {attachments.map((att) => (
        <View
          key={att.id}
          className="flex-row items-center bg-muted rounded-xl px-3 py-2 gap-2"
          style={{ maxWidth: 200 }}
        >
          <Icon
            name={canInline(att) ? "file-text" : "paperclip"}
            size={14}
            color={canInline(att) ? accent : mutedForeground}
          />
          <View className="flex-1">
            <Text className="text-foreground text-xs font-semibold" numberOfLines={1}>
              {att.name}
            </Text>
            <Text className="text-muted-foreground text-[10px]">
              {formatSize(att.size)}{canInline(att) ? " (inline)" : ""}
            </Text>
          </View>
          <Pressable
            className="w-5 h-5 rounded-full bg-card items-center justify-center active:opacity-80"
            onPress={() => onRemove(att.id)}
          >
            <Icon name="x" size={10} color={mutedForeground} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}
