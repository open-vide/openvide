import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionSheetIOS, Alert, Animated, FlatList, KeyboardAvoidingView, Modal, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, Text, View } from "react-native";
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
import { GlassContainer } from "../components/GlassContainer";
import { useVoiceInput } from "../core/useVoiceInput";
import { getModesForTool, getDefaultMode } from "../core/modeOptions";
import type { AiMessage, AiSession } from "../core/types";
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
    updateSessionMode,
    targets,
    speechLanguage,
    showToolDetails,
  } = useAppStore();

  const insets = useSafeAreaInsets();
  const [session, setSession] = useState<AiSession | undefined>(() => getAiSession(sessionId));
  const [menuMessage, setMenuMessage] = useState<AiMessage | null>(null);
  const [sessionMenuVisible, setSessionMenuVisible] = useState(false);
  const [modelPickerVisible, setModelPickerVisible] = useState(false);
  const [inputText, setInputText] = useState(initialPrompt ?? "");
  const textBeforeVoiceRef = useRef("");

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
  console.log("[OV:ui] AiChatScreen render:", sessionId, "status=" + (session?.status ?? "none"), "messages=" + (session?.messages.length ?? 0));

  useEffect(() => {
    console.log("[OV:ui] AiChatScreen subscribing to session:", sessionId);
    const unsub = subscribeAiSession(sessionId, (updated) => {
      console.log("[OV:ui] AiChatScreen session update:", updated.status, "messages=" + updated.messages.length);
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

  const handleSessionMenu = useCallback(() => {
    if (!session) return;
    const targetId = session.targetId;
    const workDir = session.workingDirectory;

    if (Platform.OS === "ios") {
      const options = [
        ...(workDir ? ["Show Diffs"] : []),
        ...(workDir ? ["Browse Files"] : []),
        "Cancel",
      ];
      const cancelButtonIndex = options.length - 1;
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex },
        (idx) => {
          if (workDir && options[idx] === "Show Diffs") {
            navigation.navigate("SessionDiffs", { targetId, workingDirectory: workDir });
          } else if (workDir && options[idx] === "Browse Files") {
            navigation.navigate("FileBrowser", { targetId, initialPath: workDir });
          }
        },
      );
    } else {
      setSessionMenuVisible(true);
    }
  }, [session, navigation]);

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
          <Pressable
            onPress={handleSessionMenu}
            className="w-10 h-10 items-center justify-center active:opacity-80 mr-[-4px]"
          >
            <Icon name="more-vertical" size={20} />
          </Pressable>
        ),
      });
    }
  }, [session, targets, navigation, handleSessionMenu]);

  const isRunning = session?.status === "running";

  const handleSend = useCallback(async (text: string) => {
    if (!session) {
      return;
    }
    try {
      await sendAiPrompt(session.id, text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[OV:ui] send failed:", message);
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

      <QuickActions
        sessionStatus={session.status}
        tool={session.tool}
        onAction={handleSend}
      />

      <ChatToolbar
        tool={session.tool}
        mode={session.mode ?? getDefaultMode(session.tool)}
        onModeChange={handleModeChange}
        model={session.model}
        onModelPress={() => setModelPickerVisible(true)}
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
      />

      {/* Android session menu modal */}
      {Platform.OS !== "ios" && (
        <Modal transparent visible={sessionMenuVisible} animationType="fade" onRequestClose={() => setSessionMenuVisible(false)}>
          <Pressable className="flex-1 bg-black/50 justify-end" onPress={() => setSessionMenuVisible(false)}>
            <GlassContainer variant="sheet" className="pb-[34px] pt-2">
              {session?.workingDirectory && (
                <>
                  <Pressable
                    className="py-4 px-5"
                    onPress={() => {
                      setSessionMenuVisible(false);
                      navigation.navigate("SessionDiffs", {
                        targetId: session.targetId,
                        workingDirectory: session.workingDirectory!,
                      });
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Show Diffs"
                  >
                    <Text className="text-foreground text-[17px]">Show Diffs</Text>
                  </Pressable>
                  <Pressable
                    className="py-4 px-5"
                    onPress={() => {
                      setSessionMenuVisible(false);
                      navigation.navigate("FileBrowser", {
                        targetId: session.targetId,
                        initialPath: session.workingDirectory!,
                      });
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Browse Files"
                  >
                    <Text className="text-foreground text-[17px]">Browse Files</Text>
                  </Pressable>
                </>
              )}
              <Pressable
                className="py-4 px-5 border-t border-border mt-2"
                onPress={() => setSessionMenuVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text className="text-error text-[17px] font-semibold">Cancel</Text>
              </Pressable>
            </GlassContainer>
          </Pressable>
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
}
