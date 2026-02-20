import React, { useCallback } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useRoute, useNavigation, type RouteProp } from "@react-navigation/native";
import type { MainStackParamList } from "../navigation/types";
import { DiffView } from "../components/DiffView";
import { CodeBlock } from "../components/CodeBlock";

type DiffViewerRoute = RouteProp<MainStackParamList, "DiffViewer">;

export function DiffViewerScreen(): JSX.Element {
  const route = useRoute<DiffViewerRoute>();
  const navigation = useNavigation();
  const { diff, filePath, language } = route.params;

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
        <Pressable
          onPress={handleCopy}
          className="ml-2 px-3 py-1.5 bg-muted rounded-lg active:opacity-80"
        >
          <Text className="text-accent text-xs font-semibold">Copy</Text>
        </Pressable>
      </View>

      <ScrollView className="flex-1">
        {hasDiffContent ? (
          <DiffView diff={diff} filePath={filePath} language={language} />
        ) : (
          <CodeBlock code={diff} language={language} showCopyButton={false} />
        )}
      </ScrollView>
    </View>
  );
}
