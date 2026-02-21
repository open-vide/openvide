import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppStore } from "../state/AppStoreContext";
import { buildColoredReadableDisplay, type TerminalColoredLine } from "../core/terminalView";
import { TerminalSpecialKeysBar } from "../components/TerminalSpecialKeysBar";
import { Icon } from "../components/Icon";
import { cn } from "../lib/utils";
import { useThemeColors } from "../constants/colors";
import type { RunRecord } from "../core/types";
import type { MainStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<MainStackParamList, "Terminal">;

function StatusDot({ status }: { status: RunRecord["status"] | null }): JSX.Element {
  const colorClass =
    status === "running" ? "bg-success" :
      status === "connecting" ? "bg-warning" :
        status === "failed" ? "bg-destructive" :
          "bg-muted-foreground";
  return <View className={cn("w-2 h-2 rounded-full", colorClass)} />;
}

export function TerminalScreen({ route, navigation }: Props): JSX.Element {
  const { targetId } = route.params;
  const {
    getTarget,
    startCommandRun,
    sendRunInput,
    cancelRun,
    subscribeRun,
  } = useAppStore();

  const { accent, mutedForeground, dimmed } = useThemeColors();
  const target = getTarget(targetId);
  const [command, setCommand] = useState("");
  const [timeout, setTimeout_] = useState("300");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [terminalLines, setTerminalLines] = useState<TerminalColoredLine[]>([]);
  const [terminalText, setTerminalText] = useState("");
  const [runStatus, setRunStatus] = useState<RunRecord["status"] | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [autoFollow, setAutoFollow] = useState(true);

  useEffect(() => {
    if (!activeRunId) return;
    const unsub = subscribeRun(activeRunId, (run) => {
      const display = buildColoredReadableDisplay(run, { maxLines: 500 });
      setTerminalLines(display.lines);
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

  // Set header actions
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View className="flex-row items-center gap-2">
          <Pressable
            className="w-9 h-9 rounded-full bg-muted items-center justify-center active:opacity-80"
            onPress={() => {
              setTerminalLines([]);
              setTerminalText("");
            }}
          >
            <Icon name="trash-2" size={16} color={mutedForeground} />
          </Pressable>
          <Pressable
            className="w-9 h-9 rounded-full bg-muted items-center justify-center active:opacity-80"
            onPress={() => {
              if (terminalText) void Clipboard.setStringAsync(terminalText);
            }}
          >
            <Icon name="copy" size={16} color={mutedForeground} />
          </Pressable>
        </View>
      ),
    });
  }, [navigation, mutedForeground, terminalText]);

  const handleRun = useCallback(async () => {
    const trimmed = command.trim();
    if (trimmed.length === 0) return;
    try {
      const run = await startCommandRun({
        targetId,
        command: trimmed,
        timeoutSec: parseInt(timeout, 10) || 300,
        sourceManagedEnv: true,
      });
      setActiveRunId(run.id);
      setTerminalLines([]);
      setTerminalText("");
      setRunStatus(run.status);
      setCommand("");
    } catch (err) {
      setTerminalText(err instanceof Error ? err.message : String(err));
    }
  }, [command, timeout, targetId, startCommandRun]);

  const handleSendInput = useCallback(async (input: string) => {
    if (!activeRunId) return;
    await sendRunInput(activeRunId, input);
  }, [activeRunId, sendRunInput]);

  const handleCancel = useCallback(async () => {
    if (!activeRunId) return;
    await cancelRun(activeRunId);
  }, [activeRunId, cancelRun]);

  const handlePaste = useCallback(async () => {
    if (!activeRunId) return;
    const text = await Clipboard.getStringAsync();
    if (text) await sendRunInput(activeRunId, text);
  }, [activeRunId, sendRunInput]);

  const isRunning = runStatus === "connecting" || runStatus === "running";

  const statusLabel =
    runStatus === "running" ? "Running" :
      runStatus === "connecting" ? "Connecting" :
        runStatus === "completed" ? "Completed" :
          runStatus === "failed" ? "Failed" :
            runStatus === "cancelled" ? "Cancelled" :
              runStatus === "timeout" ? "Timeout" :
                "Ready";

  if (!target) {
    return (
      <View className="flex-1 bg-background">
        <Text className="text-dimmed text-sm text-center mt-10">Target not found</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      {/* Terminal output */}
      <ScrollView
        ref={scrollRef}
        className="flex-1 bg-[#1E1E1E]"
        contentContainerStyle={{ padding: 12 }}
      >
        {terminalLines.length === 0 ? (
          <Text style={{ color: "#D4D4D4" }} className="font-mono text-xs leading-[18px]">Terminal ready.</Text>
        ) : (
          terminalLines.map((line, lineIdx) => (
            <Text key={lineIdx} className="font-mono text-xs leading-[18px]">
              {line.length === 0 ? "\n" : line.map((span, spanIdx) => (
                <Text
                  key={spanIdx}
                  style={{
                    color: span.attrs.fg ?? "#D4D4D4",
                    backgroundColor: span.attrs.bg,
                    fontWeight: span.attrs.bold ? "700" : undefined,
                    fontStyle: span.attrs.italic ? "italic" : undefined,
                    textDecorationLine: span.attrs.underline ? "underline" : undefined,
                    opacity: span.attrs.dim ? 0.6 : undefined,
                  }}
                >{span.text}</Text>
              ))}
              {"\n"}
            </Text>
          ))
        )}
      </ScrollView>

      {/* Special keys bar */}
      {isRunning && (
        <TerminalSpecialKeysBar onKey={handleSendInput} />
      )}

      {/* Action row */}
      <View className="flex-row gap-2 px-3 py-2 bg-card border-t border-border">
        <Pressable
          className="flex-1 flex-row items-center justify-center gap-1.5 bg-muted rounded-lg py-2.5 active:opacity-80"
          onPress={() => {
            if (terminalText) void Clipboard.setStringAsync(terminalText);
          }}
          disabled={!terminalText}
        >
          <Icon name="copy" size={14} color={mutedForeground} />
          <Text className="text-muted-foreground text-xs font-semibold">Copy</Text>
        </Pressable>
        <Pressable
          className="flex-1 flex-row items-center justify-center gap-1.5 bg-muted rounded-lg py-2.5 active:opacity-80"
          onPress={handlePaste}
          disabled={!isRunning}
        >
          <Icon name="clipboard" size={14} color={mutedForeground} />
          <Text className="text-muted-foreground text-xs font-semibold">Paste</Text>
        </Pressable>
        <Pressable
          className="flex-1 flex-row items-center justify-center gap-1.5 bg-muted rounded-lg py-2.5 active:opacity-80"
          onPress={() => {
            setTerminalLines([]);
            setTerminalText("");
          }}
        >
          <Icon name="trash-2" size={14} color={mutedForeground} />
          <Text className="text-muted-foreground text-xs font-semibold">Clear</Text>
        </Pressable>
      </View>

      {/* Command input */}
      <View className="px-3 pb-2 bg-card">
        <View className="flex-row gap-2">
          <TextInput
            className="flex-1 bg-muted rounded-2xl p-3.5 text-foreground font-mono text-[16px]"
            value={command}
            onChangeText={setCommand}
            placeholder="$ command..."
            placeholderTextColor={dimmed}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="send"
            onSubmitEditing={isRunning ? () => handleSendInput(command + "\n") : handleRun}
          />
          {isRunning ? (
            <Pressable
              className="bg-destructive rounded-2xl px-5 justify-center active:opacity-80"
              onPress={handleCancel}
            >
              <Text className="text-white font-bold text-sm">Cancel</Text>
            </Pressable>
          ) : (
            <Pressable
              className="bg-accent rounded-2xl px-5 justify-center active:opacity-80"
              onPress={handleRun}
            >
              <Text className="text-white font-bold text-sm">Run</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Status bar */}
      <View className="flex-row items-center justify-between px-4 py-2 bg-card border-t border-border">
        <View className="flex-row items-center gap-2">
          <StatusDot status={runStatus} />
          <Text className="text-dimmed text-xs">{statusLabel}</Text>
        </View>
        <Pressable onPress={() => setAutoFollow((v) => !v)} className="active:opacity-80">
          <Text className={cn("text-xs font-semibold", autoFollow ? "text-accent" : "text-dimmed")}>
            Auto-follow: {autoFollow ? "ON" : "OFF"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
