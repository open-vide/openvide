import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useRoute, useNavigation, type RouteProp } from "@react-navigation/native";
import type { MainStackParamList } from "../navigation/types";
import { DiffView } from "../components/DiffView";
import { CodeBlock } from "../components/CodeBlock";
import { useThemeColors } from "../constants/colors";
import { cn } from "../lib/utils";

type DiffViewerRoute = RouteProp<MainStackParamList, "DiffViewer">;

export function DiffViewerScreen(): JSX.Element {
  const route = useRoute<DiffViewerRoute>();
  const navigation = useNavigation();
  const { diff, filePath, language } = route.params;
  const { mutedForeground } = useThemeColors();
  const [mode, setMode] = useState<"unified" | "split">("unified");

  const fileName = filePath?.split("/").pop() ?? "Diff";

  React.useEffect(() => {
    navigation.setOptions({ title: fileName });
  }, [fileName, navigation]);

  const handleCopy = useCallback(() => {
    void Clipboard.setStringAsync(diff);
  }, [diff]);

  const hasDiffContent = diff.includes("@@") || diff.includes("---") || diff.includes("+++");

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center justify-between px-4 py-2 bg-card border-b border-border">
        <Text className="text-muted-foreground text-[13px] flex-1" numberOfLines={1}>
          {filePath ?? "Diff"}
        </Text>
        <View className="flex-row items-center gap-2 ml-2">
          {hasDiffContent && (
            <View className="flex-row bg-muted rounded-lg overflow-hidden">
              <Pressable
                className={cn(
                  "px-3 py-1.5 active:opacity-80",
                  mode === "unified" && "bg-accent",
                )}
                onPress={() => setMode("unified")}
              >
                <Text className={cn("text-xs font-semibold", mode === "unified" ? "text-white" : "text-muted-foreground")}>
                  Unified
                </Text>
              </Pressable>
              <Pressable
                className={cn(
                  "px-3 py-1.5 active:opacity-80",
                  mode === "split" && "bg-accent",
                )}
                onPress={() => setMode("split")}
              >
                <Text className={cn("text-xs font-semibold", mode === "split" ? "text-white" : "text-muted-foreground")}>
                  Split
                </Text>
              </Pressable>
            </View>
          )}
          <Pressable
            onPress={handleCopy}
            className="px-3 py-1.5 bg-muted rounded-lg active:opacity-80"
          >
            <Text className="text-accent text-xs font-semibold">Copy</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView className="flex-1">
        {hasDiffContent ? (
          <DiffView diff={diff} filePath={filePath} language={language} mode={mode} />
        ) : (
          <CodeBlock code={diff} language={language} showCopyButton={false} />
        )}
      </ScrollView>
    </View>
  );
}
