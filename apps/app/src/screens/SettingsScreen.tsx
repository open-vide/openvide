import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppStore } from "../state/AppStoreContext";
import { SectionCard } from "../components/SectionCard";
import { cn } from "../lib/utils";
import { useThemeColors } from "../constants/colors";
import { Icon } from "../components/Icon";
import { ProviderIcon } from "../components/ProviderIcon";
import type { MainStackParamList } from "../navigation/types";
import { requestPermissions } from "../core/notifications";
import type { BridgeRuntimeConfig } from "../core/ai/Transport";

import { useBiometricSettings } from "../components/BiometricGate";

type Props = NativeStackScreenProps<MainStackParamList, "Settings">;

const SPEECH_LANGUAGES = [
  { value: "en-US", label: "English" },
  { value: "it-IT", label: "Italiano" },
  { value: "es-ES", label: "Espa\u00f1ol" },
  { value: "fr-FR", label: "Fran\u00e7ais" },
  { value: "de-DE", label: "Deutsch" },
  { value: "pt-BR", label: "Portugu\u00eas" },
  { value: "zh-CN", label: "\u4e2d\u6587" },
  { value: "ja-JP", label: "\u65e5\u672c\u8a9e" },
];

export function SettingsScreen({ navigation }: Props): JSX.Element {
  const {
    targets,
    sessions,
    listSessionsByTarget,
    clearSessions,
    showToolDetails,
    setShowToolDetails,
    notificationsEnabled,
    setNotificationsEnabled,
    speechLanguage,
    setSpeechLanguage,
    getBridgeConfig,
    updateBridgeConfig,
  } = useAppStore();

  const {
    accent,
    foreground,
    mutedForeground,
    muted,
    primaryForeground,
  } = useThemeColors();

  // iOS Switch thumb is always white — fall back to mutedForeground when accent is white (Codex dark)
  const switchActiveTrack = accent === "#FFFFFF" ? mutedForeground : accent;

  const biometric = useBiometricSettings();
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(targets[0]?.id ?? null);
  const [bridgeConfig, setBridgeConfig] = useState<BridgeRuntimeConfig | null>(null);
  const [bridgeLoading, setBridgeLoading] = useState(false);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [defaultCwdDraft, setDefaultCwdDraft] = useState("");

  useEffect(() => {
    if (!selectedTargetId && targets.length > 0) {
      setSelectedTargetId(targets[0]!.id);
    }
  }, [selectedTargetId, targets]);

  const loadBridgeConfig = useCallback(async (targetId: string) => {
    setBridgeLoading(true);
    setBridgeError(null);
    try {
      const config = await getBridgeConfig(targetId);
      setBridgeConfig(config);
      setDefaultCwdDraft(config.defaultCwd);
    } catch (err) {
      setBridgeError(err instanceof Error ? err.message : String(err));
      setBridgeConfig(null);
      setDefaultCwdDraft("");
    } finally {
      setBridgeLoading(false);
    }
  }, [getBridgeConfig]);

  useEffect(() => {
    if (!selectedTargetId) return;
    void loadBridgeConfig(selectedTargetId);
  }, [loadBridgeConfig, selectedTargetId]);

  const handleBridgeUpdate = useCallback(async (updates: Partial<BridgeRuntimeConfig>) => {
    if (!selectedTargetId) return;
    try {
      const updated = await updateBridgeConfig(selectedTargetId, updates);
      setBridgeConfig(updated);
      setDefaultCwdDraft(updated.defaultCwd);
    } catch (err) {
      Alert.alert("Bridge Update Failed", err instanceof Error ? err.message : String(err));
    }
  }, [selectedTargetId, updateBridgeConfig]);

  const selectedTarget = targets.find((target) => target.id === selectedTargetId);
  const endpointUrl = selectedTarget?.connectionType === "bridge" && selectedTarget.bridgeUrl
    ? `${selectedTarget.bridgeUrl}/v1/chat/completions`
    : "/v1/chat/completions";
  const pinnedSessions = useMemo(
    () => (selectedTargetId ? listSessionsByTarget(selectedTargetId).filter((session) => !!session.daemonSessionId) : []),
    [listSessionsByTarget, selectedTargetId],
  );

  const handleClearSessions = (): void => {
    Alert.alert(
      "Clear Session History",
      `Delete all ${sessions.length} session(s)? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            void clearSessions();
          },
        },
      ],
    );
  };

  const handleNotificationsToggle = async (value: boolean): Promise<void> => {
    if (value) {
      const granted = await requestPermissions();
      if (!granted) {
        Alert.alert("Permissions Required", "Please enable notifications in your device settings.");
        return;
      }
    }
    setNotificationsEnabled(value);
  };

  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
      <SectionCard title="Appearance">
        <Pressable
          className="bg-muted rounded-2xl p-3.5 flex-row items-center justify-between active:opacity-80"
          onPress={() => navigation.getParent()?.navigate("ThemeStyleSheet")}
        >
          <View>
            <Text className="text-accent font-semibold text-sm">Theme Style</Text>
            <Text className="text-dimmed text-xs mt-0.5">Choose your app theme</Text>
          </View>
          <Icon name="chevron-right" size={18} color={mutedForeground} />
        </Pressable>
      </SectionCard>

      <SectionCard title="Security">
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1 shrink">
            <Text className="text-foreground text-[15px]">App Lock</Text>
            <Text className="text-dimmed text-xs mt-0.5">
              {biometric.available
                ? `Require ${biometric.biometricLabel} to open`
                : "Not available on this device"}
            </Text>
          </View>
          <Switch
            value={biometric.enabled}
            onValueChange={(v) => void biometric.toggle(v)}
            disabled={!biometric.available || biometric.loading}
            trackColor={{ false: muted, true: switchActiveTrack }}
          />
        </View>
      </SectionCard>

      <SectionCard title="AI Behavior">
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1 shrink">
            <Text className="text-foreground text-[15px]">Show tool details</Text>
            <Text className="text-dimmed text-xs mt-0.5">
              Expand tool cards to show file edits, commands, and other actions as they happen
            </Text>
          </View>
          <Switch
            value={showToolDetails}
            onValueChange={setShowToolDetails}
            trackColor={{ false: muted, true: switchActiveTrack }}
          />
        </View>
      </SectionCard>

      <SectionCard title="Notifications">
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1 shrink">
            <Text className="text-foreground text-[15px]">Session notifications</Text>
            <Text className="text-dimmed text-xs mt-0.5">
              Get notified when sessions complete or need input
            </Text>
          </View>
          <Switch
            value={notificationsEnabled}
            onValueChange={(v) => void handleNotificationsToggle(v)}
            trackColor={{ false: muted, true: switchActiveTrack }}
          />
        </View>
      </SectionCard>

      <SectionCard title="Customization">
        <Pressable
          className="bg-muted rounded-2xl p-3.5 active:opacity-80"
          onPress={() => navigation.getParent()?.navigate("PromptLibrarySheet")}
        >
          <Text className="text-accent font-semibold text-sm">Prompt Library</Text>
          <Text className="text-dimmed text-xs mt-0.5">Manage quick action templates</Text>
        </Pressable>
      </SectionCard>

      <SectionCard title="Claude">
        <Pressable
          className="bg-muted rounded-2xl p-3.5 flex-row items-center justify-between active:opacity-80"
          onPress={() => navigation.navigate("Schedules")}
        >
          <View>
            <Text className="text-accent font-semibold text-sm">Scheduled Tasks</Text>
            <Text className="text-dimmed text-xs mt-0.5">Create, edit, and run daemon schedules</Text>
          </View>
          <Icon name="chevron-right" size={18} color={mutedForeground} />
        </Pressable>
      </SectionCard>

      <SectionCard title="Even AI Bridge">
        {targets.length === 0 ? (
          <Text className="text-dimmed text-xs">Add a host first to configure bridge routing.</Text>
        ) : (
          <>
            <Text className="text-dimmed text-xs">Target Host</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {targets.map((target) => {
                const selected = target.id === selectedTargetId;
                return (
                  <Pressable
                    key={target.id}
                    className="px-3.5 py-2.5 rounded-2xl active:opacity-80"
                    style={{ backgroundColor: selected ? accent : muted }}
                    onPress={() => setSelectedTargetId(target.id)}
                  >
                    <Text style={{ color: selected ? primaryForeground : foreground }}>{target.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View className="bg-muted rounded-2xl p-3.5 gap-2">
              <Text className="text-foreground text-[15px]">Endpoint</Text>
              <Text className="text-dimmed text-xs">{endpointUrl}</Text>
            </View>

            {bridgeLoading ? (
              <View className="py-6 items-center">
                <ActivityIndicator size="small" />
              </View>
            ) : bridgeError ? (
              <Text className="text-error-bright text-xs">{bridgeError}</Text>
            ) : bridgeConfig ? (
              <>
                <View className="gap-2">
                  <Text className="text-dimmed text-xs">Default Tool</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {(["claude", "codex"] as const).map((tool) => {
                      const selected = bridgeConfig.evenAiTool === tool;
                      return (
                        <Pressable
                          key={tool}
                          className="px-3.5 py-2.5 rounded-2xl active:opacity-80 flex-row items-center gap-2"
                          style={{ backgroundColor: selected ? accent : muted }}
                          onPress={() => void handleBridgeUpdate({ evenAiTool: tool })}
                        >
                          <ProviderIcon tool={tool} size={14} />
                          <Text style={{ color: selected ? primaryForeground : foreground }}>{tool}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>

                <View className="gap-2">
                  <Text className="text-dimmed text-xs">Routing Mode</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {([
                      { id: "last", label: "Latest Session" },
                      { id: "new", label: "Always New" },
                      { id: "pinned", label: "Pinned Session" },
                    ] as const).map((mode) => {
                      const selected = bridgeConfig.evenAiMode === mode.id;
                      return (
                        <Pressable
                          key={mode.id}
                          className="px-3.5 py-2.5 rounded-2xl active:opacity-80"
                          style={{ backgroundColor: selected ? accent : muted }}
                          onPress={() => void handleBridgeUpdate({ evenAiMode: mode.id })}
                        >
                          <Text style={{ color: selected ? primaryForeground : foreground }}>{mode.label}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>

                {bridgeConfig.evenAiMode === "pinned" ? (
                  <View className="gap-2">
                    <Text className="text-dimmed text-xs">Pinned Session</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                      {pinnedSessions.length > 0 ? pinnedSessions.map((session) => {
                        const daemonSessionId = session.daemonSessionId!;
                        const selected = bridgeConfig.evenAiPinnedSessionId === daemonSessionId;
                        return (
                          <Pressable
                            key={session.id}
                            className="px-3.5 py-2.5 rounded-2xl active:opacity-80 flex-row items-center gap-2"
                            style={{ backgroundColor: selected ? accent : muted }}
                            onPress={() => void handleBridgeUpdate({ evenAiPinnedSessionId: daemonSessionId })}
                          >
                            {(session.tool === "claude" || session.tool === "codex") ? <ProviderIcon tool={session.tool} size={14} /> : null}
                            <Text numberOfLines={1} style={{ color: selected ? primaryForeground : foreground }}>
                              {(session.workingDirectory?.split("/").filter(Boolean).pop() ?? session.tool)} · {daemonSessionId.slice(0, 8)}
                            </Text>
                          </Pressable>
                        );
                      }) : (
                        <Text className="text-dimmed text-xs">No daemon-backed sessions available on this host.</Text>
                      )}
                    </ScrollView>
                  </View>
                ) : null}

                <View className="gap-2">
                  <Text className="text-dimmed text-xs">Default Working Directory</Text>
                  <TextInput
                    className="bg-muted rounded-2xl px-4 py-3 text-foreground"
                    value={defaultCwdDraft}
                    onChangeText={setDefaultCwdDraft}
                    placeholder="~/projects"
                    placeholderTextColor={mutedForeground}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Pressable
                    className="rounded-2xl py-3 items-center active:opacity-80"
                    style={{ backgroundColor: defaultCwdDraft.trim() === bridgeConfig.defaultCwd ? muted : accent }}
                    onPress={() => void handleBridgeUpdate({ defaultCwd: defaultCwdDraft.trim() })}
                    disabled={defaultCwdDraft.trim() === bridgeConfig.defaultCwd}
                  >
                    <Text style={{ color: defaultCwdDraft.trim() === bridgeConfig.defaultCwd ? mutedForeground : primaryForeground }}>
                      Save Working Directory
                    </Text>
                  </Pressable>
                </View>

                <View className="bg-muted rounded-2xl p-3.5 gap-1">
                  <Text className="text-foreground text-[15px]">Latest Session ID</Text>
                  <Text className="text-dimmed text-xs">
                    {bridgeConfig.currentEvenAiSessionId || "None"}
                  </Text>
                </View>
              </>
            ) : null}
          </>
        )}
      </SectionCard>

      <SectionCard title="Data">
        <Text className="text-foreground text-[15px]">Sessions: {sessions.length}</Text>
        <Pressable
          className="bg-error-bg rounded-2xl p-3 items-center mt-2"
          onPress={handleClearSessions}
          disabled={sessions.length === 0}
        >
          <Text className={cn("text-destructive font-semibold text-sm", sessions.length === 0 && "opacity-40")}>
            Clear Session History
          </Text>
        </Pressable>
      </SectionCard>

      <SectionCard title="Speech">
        <Text className="text-foreground text-[15px]">Voice input language</Text>
        <View className="flex-row flex-wrap gap-2">
          {SPEECH_LANGUAGES.map((lang) => (
            <Pressable
              key={lang.value}
              className={cn(
                "px-3.5 py-2.5 bg-muted rounded-2xl border-2",
                speechLanguage === lang.value ? "border-accent" : "border-transparent",
              )}
              onPress={() => setSpeechLanguage(lang.value)}
            >
              <Text className={cn(
                "text-sm font-semibold",
                speechLanguage === lang.value ? "text-accent" : "text-foreground",
              )}>
                {lang.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </SectionCard>

      <SectionCard title="App">
        <View className="flex-row items-center justify-between">
          <Text className="text-foreground text-[15px]">Version</Text>
          <Text className="text-dimmed text-[15px]">0.2.1</Text>
        </View>
      </SectionCard>
    </ScrollView>
  );
}
