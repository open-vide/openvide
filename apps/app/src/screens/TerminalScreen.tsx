import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppStore } from "../state/AppStoreContext";
import { buildTerminalDisplay } from "../core/terminalView";
import { cn } from "../lib/utils";
import type { RunRecord } from "../core/types";
import type { MainStackParamList } from "../navigation/types";
import { colors } from "../constants/colors";

type Props = NativeStackScreenProps<MainStackParamList, "Terminal">;

export function TerminalScreen({ route }: Props): JSX.Element {
  const { targetId } = route.params;
  const {
    getTarget,
    startCommandRun,
    sendRunInput,
    cancelRun,
    subscribeRun,
    getRun,
  } = useAppStore();

  const target = getTarget(targetId);
  const [command, setCommand] = useState("");
  const [timeout, setTimeout_] = useState("300");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [terminalText, setTerminalText] = useState("");
  const [runStatus, setRunStatus] = useState<RunRecord["status"] | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [autoFollow, setAutoFollow] = useState(true);

  useEffect(() => {
    if (!activeRunId) {
      return;
    }
    const unsub = subscribeRun(activeRunId, (run) => {
      const display = buildTerminalDisplay(run, { mode: "readable", maxLines: 500 });
      setTerminalText(display.text);
      setRunStatus(run.status);
    });
    return unsub;
  }, [activeRunId, subscribeRun]);

  useEffect(() => {
    if (autoFollow) {
      scrollRef.current?.scrollToEnd({ animated: false });
    }
  }, [terminalText, autoFollow]);

  const handleRun = useCallback(async () => {
    const trimmed = command.trim();
    if (trimmed.length === 0) {
      return;
    }
    try {
      const run = await startCommandRun({
        targetId,
        command: trimmed,
        timeoutSec: parseInt(timeout, 10) || 300,
        sourceManagedEnv: true,
      });
      setActiveRunId(run.id);
      setTerminalText("");
      setRunStatus(run.status);
      setCommand("");
    } catch (err) {
      setTerminalText(err instanceof Error ? err.message : String(err));
    }
  }, [command, timeout, targetId, startCommandRun]);

  const handleSendInput = useCallback(async (input: string) => {
    if (!activeRunId) {
      return;
    }
    await sendRunInput(activeRunId, input);
  }, [activeRunId, sendRunInput]);

  const handleCancel = useCallback(async () => {
    if (!activeRunId) {
      return;
    }
    await cancelRun(activeRunId);
  }, [activeRunId, cancelRun]);

  const isRunning = runStatus === "connecting" || runStatus === "running";

  if (!target) {
    return (
      <View className="flex-1 bg-background">
        <Text className="text-dimmed text-sm text-center mt-10">Target not found</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        ref={scrollRef}
        className="flex-1 bg-[#1E1E1E]"
        contentContainerStyle={{ padding: 12 }}
      >
        <Text style={{ color: "#D4D4D4" }} className="font-mono text-xs leading-[18px]">{terminalText || "Terminal ready."}</Text>
      </ScrollView>

      <View className="border-t border-border bg-card p-3 gap-2">
        <View className="flex-row gap-2">
          <TextInput
            className="flex-1 bg-muted rounded-lg px-3.5 py-3 text-foreground font-mono text-sm"
            value={command}
            onChangeText={setCommand}
            placeholder="$ command..."
            placeholderTextColor={colors.dimmed}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="send"
            onSubmitEditing={isRunning ? () => handleSendInput(command + "\n") : handleRun}
          />
          {isRunning ? (
            <Pressable className="bg-destructive rounded-lg px-4 justify-center" onPress={handleCancel}>
              <Text className="text-white font-bold text-sm">Cancel</Text>
            </Pressable>
          ) : (
            <Pressable className="bg-accent rounded-lg px-4 justify-center" onPress={handleRun}>
              <Text className="text-white font-bold text-sm">Run</Text>
            </Pressable>
          )}
        </View>

        {isRunning && (
          <View className="flex-row gap-2">
            <Pressable className="bg-muted px-3 py-1.5 rounded-md" onPress={() => handleSendInput("\n")}>
              <Text className="text-muted-foreground font-mono text-xs">Enter</Text>
            </Pressable>
            <Pressable className="bg-muted px-3 py-1.5 rounded-md" onPress={() => handleSendInput("\u0003")}>
              <Text className="text-muted-foreground font-mono text-xs">Ctrl+C</Text>
            </Pressable>
            <Pressable className="bg-muted px-3 py-1.5 rounded-md" onPress={() => handleSendInput("\u001B")}>
              <Text className="text-muted-foreground font-mono text-xs">Esc</Text>
            </Pressable>
            <Pressable className="bg-muted px-3 py-1.5 rounded-md" onPress={() => handleSendInput("\t")}>
              <Text className="text-muted-foreground font-mono text-xs">Tab</Text>
            </Pressable>
          </View>
        )}

        <View className="flex-row justify-between">
          {runStatus && <Text className="text-dimmed text-xs">Status: {runStatus}</Text>}
          <Pressable onPress={() => setAutoFollow((v) => !v)}>
            <Text className={cn("text-xs", autoFollow ? "text-accent" : "text-dimmed")}>
              Auto-follow: {autoFollow ? "ON" : "OFF"}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
