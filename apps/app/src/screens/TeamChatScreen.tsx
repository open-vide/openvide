import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppStore } from "../state/AppStoreContext";
import { GlassContainer } from "../components/GlassContainer";
import { ProviderIcon } from "../components/ProviderIcon";
import { InputBar } from "../components/InputBar";
import { Icon } from "../components/Icon";
import { useThemeColors } from "../constants/colors";
import type { TeamInfo, TeamMessageInfo } from "../core/ai/Transport";
import type { MainStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<MainStackParamList, "TeamChat">;

export function TeamChatScreen({ route, navigation }: Props): JSX.Element {
  const { teamId } = route.params;
  const { getTeamMessages, sendTeamMessage, getTeam } = useAppStore();
  const { dimmed, accent, foreground, mutedForeground, primaryForeground } = useThemeColors();
  const insets = useSafeAreaInsets();

  const [team, setTeam] = useState<TeamInfo | null>(null);
  const [messages, setMessages] = useState<TeamMessageInfo[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [recipient, setRecipient] = useState("*");

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshMessages = useCallback(async () => {
    try {
      const msgs = await getTeamMessages(teamId, 100);
      setMessages(msgs);
    } catch {
      // ignore
    }
  }, [getTeamMessages, teamId]);

  const refreshTeam = useCallback(async () => {
    try {
      const item = await getTeam(teamId);
      setTeam(item);
      navigation.setOptions({ title: `${item.name} Chat` });
    } catch {
      // ignore
    }
  }, [getTeam, navigation, teamId]);

  useEffect(() => {
    void refreshTeam();
    void refreshMessages();
  }, [refreshMessages, refreshTeam]);

  useEffect(() => {
    pollRef.current = setInterval(() => {
      void refreshMessages();
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refreshMessages]);

  const handleSend = useCallback(async (content: string) => {
    if (!content.trim()) return;
    setSending(true);
    try {
      await sendTeamMessage(teamId, recipient, content.trim());
      setText("");
      await refreshMessages();
    } finally {
      setSending(false);
    }
  }, [recipient, refreshMessages, sendTeamMessage, teamId]);

  const recipientOptions = useMemo(() => {
    return [
      { id: "*", label: "Team", tool: undefined as string | undefined },
      ...(team?.members.map((member) => ({ id: member.name, label: member.name, tool: member.tool })) ?? []),
    ];
  }, [team?.members]);

  const renderMessage = useCallback(({ item }: { item: TeamMessageInfo }) => {
    const inferredTool = item.fromTool ?? team?.members.find((member) => member.name === item.from)?.tool;
    const isAgent = inferredTool === "claude" || inferredTool === "codex" || inferredTool === "gemini";
    const recipientLabel = item.to === "*" || item.to === "team"
      ? "team"
      : item.to === "user" || item.to === "you"
        ? "you"
        : item.to;

    return (
      <GlassContainer variant="card" className="p-3 gap-1.5 mx-4 mb-2">
        <View className="flex-row items-center gap-2">
          {isAgent ? <ProviderIcon tool={inferredTool as string} size={12} /> : <Icon name="user" size={12} color={dimmed} />}
          <Text className="text-dimmed text-xs">
            {item.from} → {recipientLabel}
          </Text>
        </View>
        <Text className="text-foreground text-[13px]">{item.text}</Text>
      </GlassContainer>
    );
  }, [dimmed, team?.members]);

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <View className="px-4 pt-3 pb-2 gap-2">
        <Text className="text-dimmed text-xs">Recipient</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {recipientOptions.map((option) => {
            const selected = recipient === option.id;
            return (
              <Pressable
                key={option.id}
                onPress={() => setRecipient(option.id)}
                className="px-3 py-2 rounded-full active:opacity-80 flex-row items-center gap-2"
                style={{ backgroundColor: selected ? accent : "rgba(255,255,255,0.06)" }}
              >
                {option.tool === "claude" || option.tool === "codex" || option.tool === "gemini" ? (
                  <ProviderIcon tool={option.tool} size={14} />
                ) : (
                  <Icon name={option.id === "*" ? "send" : "user"} size={12} color={selected ? primaryForeground : dimmed} />
                )}
                <Text style={{ color: selected ? primaryForeground : foreground }}>{option.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        inverted
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 8 }}
        ListEmptyComponent={
          <View className="items-center py-12 gap-3" style={{ transform: [{ scaleY: -1 }] }}>
            <Text className="text-dimmed text-sm text-center">No messages yet</Text>
            <Text className="text-dimmed text-xs text-center px-8">
              Send a message to the whole team or target a single member.
            </Text>
          </View>
        }
      />
      <InputBar
        text={text}
        onChangeText={setText}
        onSend={handleSend}
        isRunning={sending}
        inset={insets.bottom}
        placeholder={recipient === "*" ? "Message the team..." : `Message ${recipient}...`}
      />
    </KeyboardAvoidingView>
  );
}
