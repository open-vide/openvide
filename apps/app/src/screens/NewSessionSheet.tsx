import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppStore } from "../state/AppStoreContext";
import { HostStatusDot } from "../components/HostStatusDot";
import { ProviderIcon } from "../components/ProviderIcon";
import { Icon } from "../components/Icon";
import { cn } from "../lib/utils";
import type { ToolName } from "../core/types";
import type { RootStackParamList } from "../navigation/types";
import { colors } from "../constants/colors";
import { getDefaultModel } from "../core/modelOptions";
import { evaluateDaemonCompatibility } from "../core/daemonVersion";

type Props = NativeStackScreenProps<RootStackParamList, "NewSessionSheet">;

const ALL_TOOLS: ToolName[] = ["claude", "codex"];

const TOOL_LABELS: Record<ToolName, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini",
};

export function NewSessionSheet({ route, navigation }: Props): JSX.Element {
  const { targets, createDraftSession } = useAppStore();
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<ToolName | null>(null);
  const [workingDirectory, setWorkingDirectory] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hostDropdownOpen, setHostDropdownOpen] = useState(false);

  // Auto-select first host on mount
  useEffect(() => {
    if (targets.length > 0 && selectedTargetId === null) {
      setSelectedTargetId(targets[0]!.id);
    }
  }, [targets, selectedTargetId]);

  // Accept selected directory from DirectoryPicker
  useEffect(() => {
    const dir = route.params?.selectedDirectory;
    if (dir) {
      setWorkingDirectory(dir);
    }
  }, [route.params?.selectedDirectory]);

  const selectedTarget = useMemo(
    () => targets.find((t) => t.id === selectedTargetId),
    [targets, selectedTargetId],
  );

  const hasDetectionData = selectedTarget?.detectedTools != null;

  const availableTools = useMemo(() => {
    if (!selectedTarget?.detectedTools) return ALL_TOOLS;
    return ALL_TOOLS.filter((tool) => selectedTarget.detectedTools?.[tool]?.installed);
  }, [selectedTarget]);

  const effectiveModel = selectedTool ? getDefaultModel(selectedTool) : null;

  const daemonInstalled = selectedTarget?.daemonInstalled === true;
  const fallbackDaemonCompatibility = evaluateDaemonCompatibility(daemonInstalled, selectedTarget?.daemonVersion);
  const daemonCompatible = selectedTarget?.daemonCompatible ?? fallbackDaemonCompatibility.compatible;
  const daemonCompatibilityReason = selectedTarget?.daemonCompatibilityReason ?? fallbackDaemonCompatibility.reason;
  const daemonReady = daemonInstalled && daemonCompatible;
  const canStart = selectedTargetId !== null && selectedTool !== null && workingDirectory.trim().length > 0 && daemonReady;

  const handleTargetSelect = (id: string): void => {
    setSelectedTargetId(id);
    setHostDropdownOpen(false);
    // Reset tool if switching to a host where the current tool isn't available
    if (selectedTool) {
      const newTarget = targets.find((t) => t.id === id);
      if (newTarget?.detectedTools && !newTarget.detectedTools[selectedTool]?.installed) {
        setSelectedTool(null);
      }
    }
  };

  const handleToolSelect = (tool: ToolName): void => {
    setSelectedTool(tool);
  };

  const handleStart = async (): Promise<void> => {
    if (!canStart || !selectedTargetId || !selectedTool) {
      return;
    }
    console.log("[OV:ui] NewSessionSheet handleStart:", selectedTool, "model=" + (effectiveModel ?? "default"), "target=" + selectedTargetId);
    setStarting(true);
    setError(null);
    try {
      const session = await createDraftSession({
        targetId: selectedTargetId,
        tool: selectedTool,
        workingDirectory: workingDirectory.trim(),
        model: effectiveModel ?? undefined,
      });
      console.log("[OV:ui] NewSessionSheet: draft session created", session.id, "navigating to AiChat");
      navigation.goBack();
      navigation.navigate("Main", {
        screen: "AiChat",
        params: { sessionId: session.id },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[OV:ui] NewSessionSheet: createDraftSession failed:", msg);
      setError(msg);
    } finally {
      setStarting(false);
    }
  };

  return (
      <ScrollView className="flex-1 bg-card" contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Text className="text-foreground text-[15px] font-bold uppercase mt-2">Host</Text>
        {targets.length === 0 && (
          <Text className="text-dimmed text-[13px]">No hosts added yet. Add a host first.</Text>
        )}
        {targets.length > 0 && (
          <>
            {/* Dropdown trigger */}
            <Pressable
              className="flex-row items-center gap-3 p-3 bg-muted rounded-2xl border-2 border-accent"
              onPress={() => setHostDropdownOpen((v) => !v)}
            >
              {selectedTarget && <HostStatusDot status={selectedTarget.lastStatus} />}
              <View className="flex-1">
                {selectedTarget ? (
                  <>
                    <Text className="text-foreground font-semibold text-[15px]">{selectedTarget.label}</Text>
                    <Text className="text-muted-foreground text-[13px]">
                      {selectedTarget.username}@{selectedTarget.host}:{selectedTarget.port}
                    </Text>
                  </>
                ) : (
                  <Text className="text-dimmed text-[15px]">Select a host...</Text>
                )}
              </View>
              <Icon name={hostDropdownOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.dimmed} />
            </Pressable>

            {/* Dropdown list */}
            {hostDropdownOpen && (
              <View className="bg-muted rounded-2xl overflow-hidden">
                {targets.map((target) => (
                  <Pressable
                    key={target.id}
                    className={cn(
                      "flex-row items-center gap-3 p-3 active:opacity-80",
                      selectedTargetId === target.id && "bg-card",
                    )}
                    onPress={() => handleTargetSelect(target.id)}
                  >
                    <HostStatusDot status={target.lastStatus} />
                    <View className="flex-1">
                      <Text className="text-foreground font-semibold text-[15px]">{target.label}</Text>
                      <Text className="text-muted-foreground text-[13px]">
                        {target.username}@{target.host}:{target.port}
                      </Text>
                    </View>
                    {selectedTargetId === target.id && (
                      <Icon name="check" size={18} color={colors.accent} />
                    )}
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}

        <Text className="text-foreground text-[15px] font-bold uppercase mt-2">CLI</Text>
        {selectedTargetId && hasDetectionData && availableTools.length === 0 && (
          <Text className="text-warning text-[13px]">No CLI tools detected on this host. Install tools from the host detail screen.</Text>
        )}
        {selectedTargetId && !hasDetectionData && (
          <Text className="text-dimmed text-[13px]">Tools not yet detected on this host. All tools shown.</Text>
        )}
        <View className="flex-row gap-3">
          {(hasDetectionData ? availableTools : ALL_TOOLS).map((tool) => (
            <Pressable
              key={tool}
              className={cn(
                "flex-1 flex-row items-center gap-2.5 px-4 py-4 bg-muted rounded-2xl border-2",
                selectedTool === tool ? "border-accent" : "border-transparent",
              )}
              onPress={() => handleToolSelect(tool)}
            >
              <ProviderIcon tool={tool as "claude" | "codex"} size={24} />
              <Text className={cn(
                "text-[15px] font-semibold",
                selectedTool === tool ? "text-accent" : "text-foreground",
              )}>
                {TOOL_LABELS[tool]}
              </Text>
            </Pressable>
          ))}
        </View>


        <Text className="text-foreground text-[15px] font-bold uppercase mt-2">Directory</Text>
        <View className="flex-row items-center gap-2">
          <TextInput
            className="flex-1 bg-muted rounded-2xl p-4 text-foreground text-[16px]"
            value={workingDirectory}
            onChangeText={setWorkingDirectory}
            placeholder="/home/user/project"
            placeholderTextColor={colors.dimmed}
          />
          <Pressable
            className={cn(
              "w-12 h-12 rounded-2xl bg-muted items-center justify-center active:opacity-80",
              !selectedTargetId && "opacity-40",
            )}
            onPress={() => {
              if (selectedTargetId) {
                navigation.navigate("DirectoryPicker", {
                  targetId: selectedTargetId,
                  currentPath: workingDirectory.trim() || undefined,
                  returnTo: "NewSessionSheet",
                });
              }
            }}
            disabled={!selectedTargetId}
          >
            <Icon name="folder" size={20} color={colors.accent} />
          </Pressable>
        </View>

        {selectedTargetId && !daemonInstalled && (
          <View className="flex-row items-center gap-2 bg-muted rounded-2xl p-3">
            <Icon name="alert-triangle" size={16} color={colors.warning} />
            <Text className="text-warning text-[13px] flex-1">
              Open Vide daemon not installed on this host. Install it from the host detail screen.
            </Text>
          </View>
        )}
        {selectedTargetId && daemonInstalled && !daemonCompatible && (
          <View className="flex-row items-center gap-2 bg-muted rounded-2xl p-3">
            <Icon name="alert-triangle" size={16} color={colors.warning} />
            <Text className="text-warning text-[13px] flex-1">
              {daemonCompatibilityReason ?? "Open Vide daemon is outdated. Update it from the host detail screen."}
            </Text>
          </View>
        )}

        {error && <Text className="text-error-bright text-[13px]">{error}</Text>}

        <Pressable
          className={cn("bg-accent rounded-full py-4 items-center mt-3 flex-row justify-center gap-2", (!canStart || starting) && "opacity-40")}
          onPress={handleStart}
          disabled={!canStart || starting}
        >
          {starting && <ActivityIndicator size="small" color="#ffffff" />}
          <Text className="text-white font-bold text-base">{starting ? "Starting..." : "Start Session"}</Text>
        </Pressable>
      </ScrollView>
  );
}
