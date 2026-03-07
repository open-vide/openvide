import React from "react";
import { Pressable, Text, View } from "react-native";
import { Icon } from "./Icon";
import { useThemeColors } from "../constants/colors";

interface EditorToolbarProps {
  fileName: string;
  language: string;
  line: number;
  col: number;
  dirty: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onFind: () => void;
  onFormat: () => void;
}

export function EditorToolbar({
  fileName,
  language,
  line,
  col,
  dirty,
  onUndo,
  onRedo,
  onFind,
  onFormat,
}: EditorToolbarProps): JSX.Element {
  const { mutedForeground, accent } = useThemeColors();

  return (
    <View className="flex-row items-center justify-between px-3 py-2 bg-card border-b border-border">
      <View className="flex-row items-center gap-2 flex-1">
        <View className="flex-row items-center gap-1">
          {dirty && (
            <View className="w-2 h-2 rounded-full bg-accent" />
          )}
          <Text className="text-foreground text-xs font-semibold" numberOfLines={1} style={{ maxWidth: 120 }}>
            {fileName}
          </Text>
        </View>
        {language ? (
          <View className="bg-muted rounded px-1.5 py-0.5">
            <Text className="text-muted-foreground text-[10px] uppercase">{language}</Text>
          </View>
        ) : null}
        <Text className="text-muted-foreground text-[10px]">{line}:{col}</Text>
      </View>
      <View className="flex-row items-center gap-1">
        <Pressable
          className="w-8 h-8 items-center justify-center active:opacity-80"
          onPress={onUndo}
        >
          <Icon name="rotate-ccw" size={16} color={mutedForeground} />
        </Pressable>
        <Pressable
          className="w-8 h-8 items-center justify-center active:opacity-80"
          onPress={onRedo}
        >
          <Icon name="rotate-cw" size={16} color={mutedForeground} />
        </Pressable>
        <Pressable
          className="w-8 h-8 items-center justify-center active:opacity-80"
          onPress={onFind}
        >
          <Icon name="search" size={16} color={mutedForeground} />
        </Pressable>
        <Pressable
          className="w-8 h-8 items-center justify-center active:opacity-80"
          onPress={onFormat}
        >
          <Icon name="align-left" size={16} color={mutedForeground} />
        </Pressable>
      </View>
    </View>
  );
}
