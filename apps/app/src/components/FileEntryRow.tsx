import React from "react";
import { Pressable, Text, View } from "react-native";
import type { RemoteFileEntry } from "../core/ssh/fileOps";
import { Icon } from "./Icon";
import { colors } from "../constants/colors";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const FileEntryRow = React.memo(function FileEntryRow({
  entry,
  onPress,
}: {
  entry: RemoteFileEntry;
  onPress: () => void;
}): JSX.Element {
  return (
    <Pressable
      className="flex-row items-center gap-3 px-4 py-3 border-b border-border active:bg-muted"
      onPress={onPress}
    >
      <Icon
        name={entry.isDirectory ? "folder" : "file-text"}
        size={20}
        color={entry.isDirectory ? colors.accent : colors.mutedForeground}
      />
      <View className="flex-1">
        <Text className="text-foreground text-[15px]" numberOfLines={1}>
          {entry.name}
        </Text>
        {!entry.isDirectory && (
          <Text className="text-muted-foreground text-[12px]">
            {formatSize(entry.size)}
          </Text>
        )}
      </View>
      {entry.isDirectory && (
        <Icon name="chevron-right" size={16} color={colors.mutedForeground} />
      )}
    </Pressable>
  );
});
