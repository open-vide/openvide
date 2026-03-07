import React from "react";
import { Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppStore } from "../state/AppStoreContext";
import { SectionCard } from "../components/SectionCard";
import { cn } from "../lib/utils";
import { useThemeColors } from "../constants/colors";
import { Icon } from "../components/Icon";
import type { MainStackParamList } from "../navigation/types";
import { requestPermissions } from "../core/notifications";

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
    sessions,
    clearSessions,
    showToolDetails,
    setShowToolDetails,
    notificationsEnabled,
    setNotificationsEnabled,
    speechLanguage,
    setSpeechLanguage,
  } = useAppStore();

  const { colorScheme, setColorScheme, accent, mutedForeground, muted } = useThemeColors();

  const biometric = useBiometricSettings();

  const APPEARANCE_OPTIONS = [
    { value: "system" as const, label: "System", icon: "smartphone" as const },
    { value: "light" as const, label: "Light", icon: "sun" as const },
    { value: "dark" as const, label: "Dark", icon: "moon" as const },
  ];

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
        <View className="flex-row gap-2">
          {APPEARANCE_OPTIONS.map((opt) => {
            const active = colorScheme === opt.value;
            return (
              <Pressable
                key={opt.value}
                className={cn(
                  "flex-1 items-center py-3 rounded-2xl border-2",
                  active ? "border-accent bg-muted" : "border-transparent bg-muted",
                )}
                onPress={() => setColorScheme(opt.value)}
              >
                <Icon name={opt.icon} size={20} color={active ? accent : mutedForeground} />
                <Text className={cn("text-xs mt-1 font-semibold", active ? "text-accent" : "text-muted-foreground")}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

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
            trackColor={{ false: muted, true: accent }}
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
            trackColor={{ false: muted, true: accent }}
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
            trackColor={{ false: muted, true: accent }}
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
          <Text className="text-dimmed text-[15px]">0.1.0</Text>
        </View>
      </SectionCard>
    </ScrollView>
  );
}
