import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppStore } from "../state/AppStoreContext";
import { NativeSshClient } from "../core/ssh/nativeSsh";
import { readFile, writeFile } from "../core/ssh/fileOps";
import { loadTargetCredentials } from "../state/secureStore";
import { inferLanguageFromPath } from "../core/syntaxHighlight";
import { MonacoEditor, type MonacoEditorRef, type SelectionInfo } from "../components/MonacoEditor";
import { EditorToolbar } from "../components/EditorToolbar";
import { SelectionActionBar } from "../components/SelectionActionBar";
import { useThemeColors } from "../constants/colors";
import type { MainStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<MainStackParamList, "FileEditor">;

export function FileEditorScreen({ route, navigation }: Props): JSX.Element {
  const { targetId, filePath } = route.params;
  const { getTarget, createDraftSession } = useAppStore();
  const { accent, mutedForeground } = useThemeColors();
  const target = getTarget(targetId);
  const sshRef = useRef(new NativeSshClient());
  const editorRef = useRef<MonacoEditorRef>(null);

  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);
  const [findVisible, setFindVisible] = useState(false);

  const fileName = filePath.split("/").pop() ?? "file";
  const language = inferLanguageFromPath(filePath) ?? "";

  // Load file content
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    (async () => {
      try {
        const credentials = await loadTargetCredentials(target.id);
        if (!credentials || cancelled) return;
        const result = await readFile(sshRef.current, target, credentials, filePath);
        if (cancelled) return;
        setContent(result.content);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [target, filePath]);

  const handleSave = useCallback(async () => {
    if (!target || !editorRef.current) return;
    const currentContent = editorRef.current.getContent();
    if (currentContent == null) return;
    setSaving(true);
    try {
      const credentials = await loadTargetCredentials(target.id);
      if (!credentials) throw new Error("No credentials");
      await writeFile(sshRef.current, target, credentials, filePath, currentContent, { backup: true });
      setDirty(false);
      editorRef.current.setContent(currentContent); // Reset dirty in editor
    } catch (err) {
      Alert.alert("Save Failed", err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [target, filePath]);

  // Header save button
  useEffect(() => {
    navigation.setOptions({
      title: fileName,
      headerRight: () => (
        <Pressable
          className="px-3 py-1.5 rounded-lg active:opacity-80"
          style={{ backgroundColor: dirty ? accent : "transparent" }}
          onPress={handleSave}
          disabled={saving || !dirty}
        >
          <Text
            className="text-sm font-semibold"
            style={{ color: dirty ? "#FFFFFF" : mutedForeground }}
          >
            {saving ? "Saving..." : "Save"}
          </Text>
        </Pressable>
      ),
    });
  }, [navigation, dirty, saving, accent, mutedForeground, fileName, handleSave]);

  // Warn on unsaved changes
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      if (!dirty) return;
      e.preventDefault();
      Alert.alert("Unsaved Changes", "You have unsaved changes. Discard them?", [
        { text: "Keep Editing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(e.data.action) },
      ]);
    });
    return unsubscribe;
  }, [navigation, dirty]);

  const handleAskAi = useCallback(async (prompt: string) => {
    if (!target) return;
    try {
      const session = await createDraftSession({
        targetId: target.id,
        tool: "claude",
      });
      navigation.navigate("AiChat", { sessionId: session.id, initialPrompt: prompt });
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : String(err));
    }
  }, [target, createDraftSession, navigation]);

  const handleChange = useCallback((newContent: string, isDirty: boolean) => {
    setDirty(isDirty);
  }, []);

  const handleSelection = useCallback((info: SelectionInfo) => {
    setCursorLine(info.startLine);
    setCursorCol(info.startCol);
    setSelection(info.selectedText.length > 0 ? info : null);
  }, []);

  if (!target) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <Text className="text-dimmed text-sm">Target not found</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <Text className="text-dimmed text-sm">Loading file...</Text>
      </View>
    );
  }

  if (error || content == null) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <Text className="text-destructive text-sm">{error ?? "Failed to load file"}</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <EditorToolbar
        fileName={fileName}
        language={language}
        line={cursorLine}
        col={cursorCol}
        dirty={dirty}
        onUndo={() => editorRef.current?.undo()}
        onRedo={() => editorRef.current?.redo()}
        onFind={() => {
          setFindVisible(!findVisible);
          if (!findVisible) editorRef.current?.find("");
        }}
        onFormat={() => editorRef.current?.format()}
      />

      <MonacoEditor
        ref={editorRef}
        initialContent={content}
        language={language}
        onChange={handleChange}
        onSelection={handleSelection}
        onSave={handleSave}
      />

      {selection && (
        <SelectionActionBar
          filePath={filePath}
          selectedText={selection.selectedText}
          startLine={selection.startLine}
          endLine={selection.endLine}
          onAskAi={handleAskAi}
        />
      )}
    </View>
  );
}
