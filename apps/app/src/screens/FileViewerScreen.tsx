import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useRoute, useNavigation, type RouteProp } from "@react-navigation/native";
import { useAppStore } from "../state/AppStoreContext";
import { NativeSshClient } from "../core/ssh/nativeSsh";
import { readFile, writeFile } from "../core/ssh/fileOps";
import { loadTargetCredentials } from "../state/secureStore";
import { inferLanguageFromPath } from "../core/syntaxHighlight";
import { CodeBlock } from "../components/CodeBlock";
import { Icon } from "../components/Icon";
import { useThemeColors } from "../constants/colors";
import { cn } from "../lib/utils";

type FileViewerParams = { FileViewer: { targetId: string; filePath: string } };

const MAX_EDITABLE_SIZE = 102400; // 100KB

export function FileViewerScreen(): JSX.Element {
  const route = useRoute<RouteProp<FileViewerParams, "FileViewer">>();
  const navigation = useNavigation<any>();
  const { targetId, filePath } = route.params;
  const { getTarget, createDraftSession } = useAppStore();
  const { accent, mutedForeground } = useThemeColors();
  const target = getTarget(targetId);

  const [content, setContent] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const sshRef = useRef(new NativeSshClient());

  const fileName = filePath.split("/").pop() ?? filePath;
  const language = inferLanguageFromPath(filePath);
  const canEdit = !truncated && content !== null && !loading;

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
        const result = await readFile(sshRef.current, target, creds, filePath, MAX_EDITABLE_SIZE, {
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
    if (content) {
      void Clipboard.setStringAsync(content);
    }
  }, [content]);

  const handleEnterEdit = useCallback(() => {
    if (content === null) return;
    setEditContent(content);
    setEditing(true);
    setDirty(false);
  }, [content]);

  const handleCancelEdit = useCallback(() => {
    if (dirty) {
      Alert.alert("Discard Changes?", "You have unsaved changes.", [
        { text: "Keep Editing", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            setEditing(false);
            setDirty(false);
          },
        },
      ]);
    } else {
      setEditing(false);
    }
  }, [dirty]);

  const handleSave = useCallback(async () => {
    if (!target) return;
    setSaving(true);
    try {
      const creds = await loadTargetCredentials(targetId);
      if (!creds) throw new Error("No credentials found");
      await writeFile(sshRef.current, target, creds, filePath, editContent, { backup: true });
      setContent(editContent);
      setEditing(false);
      setDirty(false);
    } catch (err) {
      Alert.alert("Save Failed", err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [target, targetId, filePath, editContent]);

  const handleEditChange = useCallback((text: string) => {
    setEditContent(text);
    setDirty(true);
  }, []);

  const handleAskAi = useCallback(async () => {
    if (!target || content === null) return;
    // Find the first supported tool
    const tools = target.detectedTools;
    const tool = tools?.claude?.installed ? "claude" as const : tools?.codex?.installed ? "codex" as const : null;
    if (!tool) {
      Alert.alert("No AI Tool", "No supported AI CLI tool is installed on this host.");
      return;
    }

    try {
      const session = await createDraftSession({
        targetId: target.id,
        tool,
      });
      const truncatedContent = content.length > 4096 ? content.slice(0, 4096) + "\n... (truncated)" : content;
      const prompt = `Regarding the file \`${filePath}\`:\n\n\`\`\`${language || ""}\n${truncatedContent}\n\`\`\`\n\nExplain this code.`;
      navigation.navigate("AiChat", { sessionId: session.id, initialPrompt: prompt });
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : String(err));
    }
  }, [target, content, filePath, language, createDraftSession, navigation]);

  // Warn on back navigation with unsaved changes
  useEffect(() => {
    if (!editing || !dirty) return;
    const unsubscribe = navigation.addListener("beforeRemove", (e: any) => {
      e.preventDefault();
      Alert.alert("Discard Changes?", "You have unsaved changes that will be lost.", [
        { text: "Keep Editing", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => navigation.dispatch(e.data.action),
        },
      ]);
    });
    return unsubscribe;
  }, [navigation, editing, dirty]);

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
        <View className="flex-row items-center gap-2 ml-2">
          {editing ? (
            <>
              <Pressable
                onPress={handleCancelEdit}
                className="px-3 py-1.5 bg-muted rounded-lg active:opacity-80"
              >
                <Text className="text-muted-foreground text-xs font-semibold">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleSave}
                className={cn(
                  "px-3 py-1.5 rounded-lg active:opacity-80",
                  dirty ? "bg-accent" : "bg-muted",
                )}
                disabled={saving || !dirty}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text className={cn("text-xs font-semibold", dirty ? "text-white" : "text-muted-foreground")}>
                    Save
                  </Text>
                )}
              </Pressable>
            </>
          ) : (
            <>
              {canEdit && (
                <>
                  <Pressable
                    onPress={() => navigation.navigate("FileEditor", { targetId, filePath })}
                    className="px-3 py-1.5 bg-accent rounded-lg active:opacity-80"
                  >
                    <Text className="text-white text-xs font-semibold">Code Editor</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleEnterEdit}
                    className="px-3 py-1.5 bg-muted rounded-lg active:opacity-80"
                  >
                    <Text className="text-accent text-xs font-semibold">Edit</Text>
                  </Pressable>
                </>
              )}
              <Pressable
                onPress={handleCopy}
                className="px-3 py-1.5 bg-muted rounded-lg active:opacity-80"
                disabled={!content}
              >
                <Text className="text-accent text-xs font-semibold">Copy</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>

      {truncated && (
        <View className="px-4 py-2 bg-warning/10">
          <Text className="text-warning text-xs">
            File truncated at 100KB. Showing partial content. Editing disabled.
          </Text>
        </View>
      )}

      {loading && (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={accent} />
          <Text className="text-dimmed text-sm mt-3">Loading file...</Text>
        </View>
      )}

      {error && (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-error-bright text-sm text-center">{error}</Text>
        </View>
      )}

      {!loading && !error && content !== null && editing && (
        <ScrollView className="flex-1" keyboardShouldPersistTaps="handled">
          <TextInput
            className="flex-1 text-foreground text-[14px] p-4 font-mono"
            style={{ fontFamily: "Menlo", minHeight: 400 }}
            value={editContent}
            onChangeText={handleEditChange}
            multiline
            textAlignVertical="top"
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
          />
        </ScrollView>
      )}

      {!loading && !error && content !== null && !editing && (
        <>
          <ScrollView className="flex-1">
            <CodeBlock
              code={content}
              language={language || undefined}
              showLineNumbers
              showCopyButton={true}
              selectable
            />
          </ScrollView>

          {/* Bottom action bar */}
          <View className="flex-row items-center justify-center gap-3 px-4 py-3 bg-card border-t border-border">
            <Pressable
              className="flex-1 flex-row items-center justify-center gap-2 bg-muted rounded-xl py-3 active:opacity-80"
              onPress={handleCopy}
            >
              <Icon name="copy" size={16} color={mutedForeground} />
              <Text className="text-foreground text-sm font-semibold">Copy</Text>
            </Pressable>
            <Pressable
              className="flex-1 flex-row items-center justify-center gap-2 bg-accent rounded-xl py-3 active:opacity-80"
              onPress={handleAskAi}
            >
              <Icon name="message-circle" size={16} color="#FFFFFF" />
              <Text className="text-white text-sm font-semibold">Ask AI</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}
