import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, FlatList, Keyboard, KeyboardAvoidingView, Linking, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppStore } from "../state/AppStoreContext";
import { AiMessageBubble } from "../components/AiMessageBubble";
import { InputBar } from "../components/InputBar";
import { QuickActions } from "../components/QuickActions";
import { MessageMenu } from "../components/MessageMenu";
import { ChatToolbar } from "../components/ChatToolbar";
import { ModelPickerSheet } from "../components/ModelPickerSheet";
import { ProviderIcon } from "../components/ProviderIcon";
import { Icon } from "../components/Icon";
import { PopoverMenu, type PopoverMenuItem } from "../components/PopoverMenu";
import { useVoiceInput } from "../core/useVoiceInput";
import { getModesForTool, getDefaultMode } from "../core/modeOptions";
import type { ModelOption } from "../core/modelOptions";
import type { AiMessage, AiSession } from "../core/types";
import type { FollowUpSuggestion } from "../core/ai/Transport";
import type { MainStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<MainStackParamList, "AiChat">;

const TOOL_LABELS: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
};

function formatTokens(n?: number): string {
  if (n == null || n === 0) return "0";
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

export function AiChatScreen({ route, navigation }: Props): JSX.Element {
  const { sessionId, initialPrompt } = route.params;
  const {
    getAiSession,
    sendAiPrompt,
    cancelAiTurn,
    subscribeAiSession,
    updateSessionModel,
    listSessionModels,
    updateSessionMode,
    targets,
    speechLanguage,
    showToolDetails,
    ensureSessionAttached,
    detachFromSession,
    refreshSessionHistory,
    getSessionFollowUpSuggestions,
    getRemoteUrl,
  } = useAppStore();

  const insets = useSafeAreaInsets();
  const [session, setSession] = useState<AiSession | undefined>(() => getAiSession(sessionId));
  const [menuMessage, setMenuMessage] = useState<AiMessage | null>(null);
  const [sessionMenuVisible, setSessionMenuVisible] = useState(false);
  const [modelPickerVisible, setModelPickerVisible] = useState(false);
  const [availableModels, setAvailableModels] = useState<ModelOption[] | undefined>(undefined);
  const [inputText, setInputText] = useState(initialPrompt ?? "");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [followUpSuggestions, setFollowUpSuggestions] = useState<FollowUpSuggestion[]>([]);
  const textBeforeVoiceRef = useRef("");
  const menuAnchorRef = useRef<View>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const activeSessionId = session?.id;

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const showSub = Keyboard.addListener("keyboardDidShow", (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardHeight(0);
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const { isListening, start: voiceStart, stop: voiceStop } = useVoiceInput(
    useCallback((transcript: string) => {
      const prefix = textBeforeVoiceRef.current;
      setInputText(prefix ? prefix + " " + transcript : transcript);
    }, []),
    speechLanguage,
  );

  const handleVoiceStart = useCallback(() => {
    textBeforeVoiceRef.current = inputText;
    voiceStart();
  }, [inputText, voiceStart]);

  useEffect(() => {
    const unsub = subscribeAiSession(sessionId, (updated) => {
      setSession(updated);
    });
    return unsub;
  }, [sessionId, subscribeAiSession]);

  useEffect(() => {
    const s = getAiSession(sessionId);
    if (s) {
      setSession(s);
    }
  }, [sessionId, getAiSession]);

  // Re-fetch daemon history on mount, attach to running sessions, detach on unmount
  useEffect(() => {
    setLoadingHistory(true);
    refreshSessionHistory(sessionId)
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
    ensureSessionAttached(sessionId);
    return () => {
      detachFromSession(sessionId);
    };
  }, [sessionId, refreshSessionHistory, ensureSessionAttached, detachFromSession]);

  useEffect(() => {
    if (!session?.conversationId) return;
    if (session.status === "running") return;

    let cancelled = false;

    const refresh = async () => {
      try {
        await refreshSessionHistory(sessionId);
      } catch {
        // Keep the current chat visible if background history refresh fails.
      }
    };

    void refresh();
    const timer = setInterval(() => {
      if (!cancelled) {
        void refresh();
      }
    }, 4000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refreshSessionHistory, session?.conversationId, session?.status, sessionId]);

  useEffect(() => {
    let cancelled = false;
    if (!session || session.status === "running" || !session.daemonSessionId) {
      setFollowUpSuggestions([]);
      return;
    }

    void getSessionFollowUpSuggestions(session.id).then((items) => {
      if (!cancelled) {
        setFollowUpSuggestions(items);
      }
    }).catch(() => {
      if (!cancelled) {
        setFollowUpSuggestions([]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [getSessionFollowUpSuggestions, session?.daemonSessionId, session?.id, session?.status, session?.updatedAt]);

  const refreshAvailableModels = useCallback(async () => {
    if (!activeSessionId) {
      setAvailableModels(undefined);
      return;
    }
    try {
      const models = await listSessionModels(activeSessionId);
      setAvailableModels(models);
    } catch {
      setAvailableModels(undefined);
    }
  }, [activeSessionId, listSessionModels]);

  useEffect(() => {
    void refreshAvailableModels();
  }, [refreshAvailableModels]);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      void refreshAvailableModels();
      // Re-fetch session from daemon when screen regains focus (e.g. after notification tap
      // or returning from background) so stale in-memory state gets updated.
      // Must run BEFORE ensureSessionAttached — otherwise the attach marks the session as
      // actively streaming and refreshSessionHistory skips it, leaving stale "running" status.
      void refreshSessionHistory(sessionId).then(() => {
        ensureSessionAttached(sessionId);
      });
    });
    return unsubscribe;
  }, [navigation, refreshAvailableModels, refreshSessionHistory, ensureSessionAttached, sessionId]);

  const handleModeChange = useCallback((mode: string) => {
    if (session) {
      updateSessionMode(session.id, mode);
    }
  }, [session, updateSessionMode]);

  const handleModelSelect = useCallback((model: string) => {
    if (session) {
      updateSessionModel(session.id, model);
    }
  }, [session, updateSessionModel]);

  const handleModelPress = useCallback(() => {
    void refreshAvailableModels();
    setModelPickerVisible(true);
  }, [refreshAvailableModels]);

  const copyChatIds = useCallback(() => {
    if (!session) return;
    const parts = [`Session: ${session.id}`];
    if (session.daemonSessionId) parts.push(`Daemon: ${session.daemonSessionId}`);
    if (session.conversationId) parts.push(`Conversation: ${session.conversationId}`);
    void Clipboard.setStringAsync(parts.join("\n"));
    Alert.alert("Copied", parts.join("\n"));
  }, [session]);

  const handleSessionMenu = useCallback(() => {
    if (!session) return;
    setSessionMenuVisible(true);
  }, [session]);

  const sessionMenuItems = useMemo((): PopoverMenuItem[] => {
    if (!session) return [];
    const items: PopoverMenuItem[] = [];
    const workDir = session.workingDirectory;
    const targetId = session.targetId;
    if (workDir) {
      items.push({
        label: "Show Diffs",
        icon: "git-commit",
        onPress: () => navigation.navigate("SessionDiffs", { targetId, workingDirectory: workDir }),
      });
      items.push({
        label: "Browse Files",
        icon: "folder",
        onPress: () => navigation.navigate("FileBrowser", { targetId, initialPath: workDir }),
      });
      items.push({
        label: "Terminal",
        icon: "terminal",
        onPress: () => navigation.navigate("Terminal", { targetId, initialDirectory: workDir }),
      });
    }
    // Claude-specific actions
    if (session.tool === "claude" && session.daemonSessionId) {
      items.push({
        label: "Open Remote",
        icon: "external-link",
        onPress: async () => {
          try {
            const url = await getRemoteUrl(session.id);
            Linking.openURL(url);
          } catch (err) {
            Alert.alert("Remote failed", err instanceof Error ? err.message : String(err));
          }
        },
      });
    }
    items.push({
      label: "Copy Chat ID",
      icon: "copy",
      onPress: copyChatIds,
    });
    return items;
  }, [session, navigation, copyChatIds]);

  useEffect(() => {
    if (session) {
      const target = targets.find((t) => t.id === session.targetId);
      const hostLabel = target?.label ?? session.tool;
      const workDir = session.workingDirectory;
      navigation.setOptions({
        headerTitle: () => (
          <View className="items-center justify-center">
            <View className="flex-row items-center gap-2">
              <ProviderIcon tool={session.tool as "claude" | "codex"} size={16} />
              <Text className="text-foreground text-[16px] font-semibold" numberOfLines={1}>
                {hostLabel}
              </Text>
            </View>
            {workDir ? (
              <Text className="text-dimmed text-[11px]" numberOfLines={1}>
                {workDir}
              </Text>
            ) : null}
          </View>
        ),
        headerRight: () => (
          <View ref={menuAnchorRef} collapsable={false}>
            <Pressable
              onPress={handleSessionMenu}
              className="w-10 h-10 items-center justify-center active:opacity-80 mr-[-4px]"
            >
              <Icon name="more-vertical" size={20} />
            </Pressable>
          </View>
        ),
      });
    }
  }, [session, targets, navigation, handleSessionMenu]);

  const isRunning = session?.status === "running";

  const handleSend = useCallback(async (text: string) => {
    if (!session) {
      return;
    }
    setFollowUpSuggestions([]);
    try {
      await sendAiPrompt(session.id, text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert("Send failed", message);
    }
  }, [session, sendAiPrompt]);

  const handleCancel = useCallback(async () => {
    if (!session) {
      return;
    }
    await cancelAiTurn(session.id);
  }, [session, cancelAiTurn]);

  const handleMenuPress = useCallback((message: AiMessage) => {
    setMenuMessage(message);
  }, []);

  const handleMenuClose = useCallback(() => {
    setMenuMessage(null);
  }, []);

  const flatListRef = useRef<FlatList>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const scrollButtonOpacity = useRef(new Animated.Value(0)).current;

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetY = e.nativeEvent.contentOffset.y;
    const shouldShow = offsetY > 300;
    setShowScrollButton(shouldShow);
    Animated.timing(scrollButtonOpacity, {
      toValue: shouldShow ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [scrollButtonOpacity]);

  const scrollToBottom = useCallback(() => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  const messages = session?.messages ?? [];
  const reversedMessages = useMemo(() => [...messages].reverse(), [messages]);

  const hasContext = session?.contextStatus === "ok" &&
    (session?.contextUsedTokens ?? 0) >= 0 &&
    (session?.contextWindowTokens ?? 0) > 0;
  const contextUsed = session?.contextUsedTokens ?? 0;
  const contextWindow = session?.contextWindowTokens ?? 0;
  const usagePercent = hasContext
    ? Math.max(0, Math.min(session?.contextPercentUsed ?? ((contextUsed / contextWindow) * 100), 100))
    : 0;
  const effectiveShowToolDetails = session?.showToolDetails ?? showToolDetails;

  if (!session) {
    return (
      <View className="flex-1 bg-background">
        <View className="flex-1 justify-center items-center">
          <Text className="text-dimmed text-[13px] text-center">Session not found</Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      style={Platform.OS === "android" ? { paddingBottom: keyboardHeight ? keyboardHeight + 16 : 0 } : undefined}
    >
      {/* Context usage bar */}
      {hasContext && (
        <View className="px-4 py-1.5 border-b border-border">
          <View className="flex-row items-center gap-2">
            <View className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <View
                className="h-full bg-accent rounded-full"
                style={{ width: `${usagePercent}%` }}
              />
            </View>
            <Text className="text-dimmed text-[11px]">
              {formatTokens(contextUsed)} / {formatTokens(contextWindow)}
            </Text>
          </View>
        </View>
      )}

      <View style={{ flex: 1 }}>
        {loadingHistory && (
          <View className="flex-row items-center justify-center gap-2 py-2 border-b border-border">
            <ActivityIndicator size="small" />
            <Text className="text-dimmed text-[12px]">Loading history...</Text>
          </View>
        )}
        <FlatList
          ref={flatListRef}
          data={reversedMessages}
          keyExtractor={(item) => item.id}
          inverted
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, gap: 20 }}
          renderItem={({ item }) => (
            <AiMessageBubble
              message={item}
              onMenuPress={handleMenuPress}
              onSendResponse={handleSend}
              showToolDetails={effectiveShowToolDetails}
            />
          )}
          onScroll={handleScroll}
          scrollEventThrottle={100}
          windowSize={10}
          maxToRenderPerBatch={8}
          removeClippedSubviews
        />
        {showScrollButton && (
          <Animated.View
            style={{ opacity: scrollButtonOpacity }}
            className="absolute bottom-3 self-center"
            pointerEvents="box-none"
          >
            <Pressable
              onPress={scrollToBottom}
              className="w-9 h-9 rounded-full bg-muted border border-border items-center justify-center active:opacity-80 shadow-sm"
            >
              <Icon name="arrow-down" size={18} />
            </Pressable>
          </Animated.View>
        )}
      </View>

      {!isRunning && followUpSuggestions.length > 0 ? (
        <QuickActions
          sessionStatus={session.status}
          tool={session.tool}
          onAction={handleSend}
          suggestions={followUpSuggestions}
        />
      ) : null}

      <ChatToolbar
        tool={session.tool}
        mode={session.mode ?? getDefaultMode(session.tool)}
        onModeChange={handleModeChange}
        model={session.model}
        onModelPress={handleModelPress}
        models={availableModels}
      />

      <InputBar
        placeholder={`Message ${TOOL_LABELS[session.tool] ?? session.tool}...`}
        isRunning={isRunning}
        inset={insets.bottom}
        text={inputText}
        onChangeText={setInputText}
        onSend={handleSend}
        onCancel={handleCancel}
        isListening={isListening}
        onVoiceStart={handleVoiceStart}
        onVoiceEnd={voiceStop}
      />

      <MessageMenu
        message={menuMessage}
        visible={menuMessage != null}
        onClose={handleMenuClose}
      />

      <ModelPickerSheet
        visible={modelPickerVisible}
        onClose={() => setModelPickerVisible(false)}
        tool={session.tool}
        selectedModelId={session.model}
        onSelectModel={handleModelSelect}
        models={availableModels}
      />

      <PopoverMenu
        visible={sessionMenuVisible}
        onClose={() => setSessionMenuVisible(false)}
        anchorRef={menuAnchorRef}
        items={sessionMenuItems}
      />
    </KeyboardAvoidingView>
  );
}
