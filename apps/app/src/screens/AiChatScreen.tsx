import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, KeyboardAvoidingView, Platform, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppStore } from "../state/AppStoreContext";
import { AiMessageBubble } from "../components/AiMessageBubble";
import { InputBar } from "../components/InputBar";
import { QuickActions } from "../components/QuickActions";
import { MessageMenu } from "../components/MessageMenu";
import { ProviderIcon } from "../components/ProviderIcon";
import { useVoiceInput } from "../core/useVoiceInput";
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
  const { sessionId } = route.params;
  const {
    getAiSession,
    sendAiPrompt,
    cancelAiTurn,
    subscribeAiSession,
    targets,
    speechLanguage,
  } = useAppStore();

  const insets = useSafeAreaInsets();
  const [session, setSession] = useState<AiSession | undefined>(() => getAiSession(sessionId));
  const [menuMessage, setMenuMessage] = useState<AiMessage | null>(null);
  const [inputText, setInputText] = useState("");
  const textBeforeVoiceRef = useRef("");
  const flatListRef = useRef<FlatList<AiMessage>>(null);

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
      });
    }
  }, [session, targets, navigation]);

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
      <View className="px-4 py-2 border-b border-border">
        <View className="flex-row items-center gap-2">
          {hasContext ? (
            <>
              <View className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <View
                  className="h-full bg-accent rounded-full"
                  style={{ width: `${usagePercent}%` }}
                />
              </View>
              <Text className="text-dimmed text-[11px]">
                {formatTokens(contextUsed)} / {formatTokens(contextWindow)}
              </Text>
            </>
          ) : (
            <Text className="text-dimmed text-[11px]">
              {session.contextLabel ?? "Context N/A"}
            </Text>
          )}
        </View>
      </View>

      <FlatList
        ref={flatListRef}
        data={reversedMessages}
        keyExtractor={(item) => item.id}
        inverted
        contentContainerStyle={{ padding: 16, gap: 20 }}
        renderItem={({ item }) => (
          <AiMessageBubble
            message={item}
            onMenuPress={handleMenuPress}
            onSendResponse={handleSend}
          />
        )}
        windowSize={10}
        maxToRenderPerBatch={8}
        removeClippedSubviews
      />

      <QuickActions
        sessionStatus={session.status}
        tool={session.tool}
        onAction={handleSend}
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
    </KeyboardAvoidingView>
  );
}
