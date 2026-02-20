import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useRoute, useNavigation, type RouteProp } from "@react-navigation/native";
import { useAppStore } from "../state/AppStoreContext";
import { NativeSshClient } from "../core/ssh/nativeSsh";
import { readFile } from "../core/ssh/fileOps";
import { loadTargetCredentials } from "../state/secureStore";
import { inferLanguageFromPath } from "../core/syntaxHighlight";
import { CodeBlock } from "../components/CodeBlock";

type FileViewerParams = { FileViewer: { targetId: string; filePath: string } };

export function FileViewerScreen(): JSX.Element {
  const route = useRoute<RouteProp<FileViewerParams, "FileViewer">>();
  const navigation = useNavigation();
  const { targetId, filePath } = route.params;
  const { getTarget } = useAppStore();
  const target = getTarget(targetId);

  const [content, setContent] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sshRef = useRef(new NativeSshClient());

  const fileName = filePath.split("/").pop() ?? filePath;
  const language = inferLanguageFromPath(filePath);

  useEffect(() => {
    navigation.setOptions({ title: fileName });
  }, [fileName, navigation]);

  useEffect(() => {
    return () => {
      void sshRef.current.dispose();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const abortController = new AbortController();

    async function load(): Promise<void> {
      if (!target) return;
      setLoading(true);
      setError(null);
      try {
        const creds = await loadTargetCredentials(targetId);
        if (!creds) throw new Error("No credentials found");
        const result = await readFile(sshRef.current, target, creds, filePath, 102400, {
          signal: abortController.signal,
        });
        if (active) {
          setContent(result.content);
          setTruncated(result.truncated);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
      abortController.abort();
    };
  }, [target, targetId, filePath]);

  const handleCopy = useCallback(() => {
    if (content) void Clipboard.setStringAsync(content);
  }, [content]);

  if (!target) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <Text className="text-dimmed text-sm">Target not found</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-2 bg-card border-b border-border">
        <Text className="text-muted-foreground text-[13px] flex-1" numberOfLines={1}>
          {filePath}
        </Text>
        <Pressable
          onPress={handleCopy}
          className="ml-2 px-3 py-1.5 bg-muted rounded-lg active:opacity-80"
          disabled={!content}
        >
          <Text className="text-accent text-xs font-semibold">Copy</Text>
        </Pressable>
      </View>

      {truncated && (
        <View className="px-4 py-2 bg-warning/10">
          <Text className="text-warning text-xs">
            File truncated at 100KB. Showing partial content.
          </Text>
        </View>
      )}

      {loading && (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#C4704B" />
          <Text className="text-dimmed text-sm mt-3">Loading file...</Text>
        </View>
      )}

      {error && (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-error-bright text-sm text-center">{error}</Text>
        </View>
      )}

      {!loading && !error && content !== null && (
        <ScrollView className="flex-1">
          <CodeBlock
            code={content}
            language={language || undefined}
            showLineNumbers
            showCopyButton={false}
          />
        </ScrollView>
      )}
    </View>
  );
}
