import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppStore } from "../state/AppStoreContext";
import { SectionCard } from "../components/SectionCard";
import { StatePill } from "../components/StatePill";
import { HostStatusDot } from "../components/HostStatusDot";
import { ProviderIcon } from "../components/ProviderIcon";
import { Icon } from "../components/Icon";
import { cn } from "../lib/utils";
import type { ToolName } from "../core/types";
import type { MainStackParamList } from "../navigation/types";
import { useThemeColors } from "../constants/colors";
import { evaluateDaemonCompatibility } from "../core/daemonVersion";

type Props = NativeStackScreenProps<MainStackParamList, "HostDetail">;

const TOOLS = ["claude", "codex"] as const;

const TOOL_LABELS: Record<ToolName, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
};

export function HostDetailScreen({ route, navigation }: Props): JSX.Element {
  const { targetId } = route.params;
  const {
    getTarget,
    deleteTarget,
    runCliDetection,
    subscribeRun,
    startDaemonInstall,
    readinessByTarget,
  } = useAppStore();

  const { accent, success, destructive } = useThemeColors();
  const target = getTarget(targetId);
  const [detecting, setDetecting] = useState(false);
  const [installingDaemon, setInstallingDaemon] = useState(false);
  const [daemonInstallStatus, setDaemonInstallStatus] = useState<string>("");
  const readiness = readinessByTarget[targetId];

  const handleDetectTools = useCallback(async (): Promise<void> => {
    if (detecting) return;
    setDetecting(true);
    try {
      await runCliDetection(targetId);
    } catch {
      // CLI detection failed — no-op
    }
    setDetecting(false);
  }, [detecting, runCliDetection, targetId]);

  // Always auto-detect on mount to ensure fresh tool status
  useEffect(() => {
    if (!target) return;
    if (!detecting) {
      void handleDetectTools();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id]);

  if (!target) {
    return (
      <View className="flex-1 bg-background">
        <Text className="text-dimmed text-sm text-center mt-10">Target not found</Text>
      </View>
    );
  }

  const handleInstallDaemon = async (): Promise<void> => {
    setInstallingDaemon(true);
    setDaemonInstallStatus("Starting install...");
    try {
      const run = await startDaemonInstall(targetId);

      await new Promise<void>((resolve) => {
        const unsub = subscribeRun(run.id, (updatedRun) => {
          // Extract latest STEP progress from events for progress display
          for (let i = updatedRun.events.length - 1; i >= 0; i--) {
            const evt = updatedRun.events[i];
            if (evt?.progress) {
              setDaemonInstallStatus(`${evt.progress.label} (${evt.progress.current}/${evt.progress.total})`);
              break;
            }
          }

          if (["completed", "failed", "cancelled", "timeout"].includes(updatedRun.status)) {
            unsub();
            if (updatedRun.status === "completed") {
              setDaemonInstallStatus("Verifying...");
            } else {
              // Extract last meaningful error line for display
              const lastEvent = updatedRun.events[updatedRun.events.length - 1];
              setDaemonInstallStatus(lastEvent?.message ?? `Install ${updatedRun.status}`);
            }
            resolve();
          }
        });
      });

      // Re-detect to update daemon status
      await runCliDetection(targetId);
    } catch {
      setDaemonInstallStatus("Install failed");
    }
    setInstallingDaemon(false);
    setDaemonInstallStatus("");
  };

  const handleDelete = (): void => {
    Alert.alert("Delete Host", `Delete "${target.label}"? This also removes all related sessions and runs.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteTarget(targetId);
          navigation.goBack();
        },
      },
    ]);
  };

  const detectedTools = target.detectedTools;
  const daemonInstalled = target.daemonInstalled === true;
  const fallbackDaemonCompatibility = evaluateDaemonCompatibility(daemonInstalled, target.daemonVersion);
  const daemonCompatible = target.daemonCompatible ?? fallbackDaemonCompatibility.compatible;
  const daemonCompatibilityReason = target.daemonCompatibilityReason ?? fallbackDaemonCompatibility.reason;
  const daemonReady = daemonInstalled && daemonCompatible;
  const daemonCtaLabel = daemonInstalled ? "Update" : "Install";

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={detecting}
          onRefresh={handleDetectTools}
          tintColor={accent}
        />
      }
    >
      {/* Host Info */}
      <SectionCard title="Host Info">
        <View className="flex-row items-center gap-2">
          <HostStatusDot status={target.lastStatus} loading={detecting} />
          <Text className="text-foreground font-bold text-lg">{target.label}</Text>
        </View>
        <Text className="text-muted-foreground text-sm">
          {target.username}@{target.host}:{target.port}
        </Text>
        <Text className="text-muted-foreground text-sm">Auth: {target.authMethod}</Text>
        {target.lastStatusReason && (
          <Text className="text-warning text-[13px]">{target.lastStatusReason}</Text>
        )}
      </SectionCard>

      {/* Daemon Status */}
      <SectionCard title="Open Vide Daemon">
        <View className="flex-row items-center gap-3 bg-muted rounded-xl p-3">
          <Icon name="server" size={28} color={accent} />
          <View className="flex-1">
            <Text className="text-foreground font-semibold text-sm">openvide-daemon</Text>
            {daemonInstalled && target.daemonVersion && (
              <Text className="text-muted-foreground text-xs">{target.daemonVersion}</Text>
            )}
          </View>
          {detecting && target.daemonInstalled == null ? (
            <ActivityIndicator size="small" color={accent} />
          ) : daemonReady ? (
            <View className="flex-row items-center gap-1">
              <Icon name="check-circle" size={14} color={success} />
              <Text className="text-success text-xs font-semibold">Installed</Text>
            </View>
          ) : (
            <Pressable
              className={cn("bg-accent px-3 py-1.5 rounded-lg", installingDaemon && "opacity-40")}
              onPress={handleInstallDaemon}
              disabled={installingDaemon}
            >
              {installingDaemon ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text className="text-white font-semibold text-xs">{daemonCtaLabel}</Text>
              )}
            </Pressable>
          )}
        </View>
        {installingDaemon && daemonInstallStatus !== "" && (
          <Text className="text-muted-foreground text-[13px]">{daemonInstallStatus}</Text>
        )}
        {!detecting && !installingDaemon && !daemonInstalled && (
          <Text className="text-warning text-[13px]">
            Daemon is required to start AI sessions. Install it to continue.
          </Text>
        )}
        {!detecting && !installingDaemon && daemonInstalled && !daemonCompatible && (
          <Text className="text-warning text-[13px]">
            {daemonCompatibilityReason ?? "Installed daemon version is not compatible. Update to continue."}
          </Text>
        )}
      </SectionCard>

      {/* CLI Tools */}
      <SectionCard title="CLI Tools">
        {TOOLS.map((tool) => {
          const info = detectedTools?.[tool];
          const isInstalled = info?.installed === true;

          return (
            <View
              key={tool}
              className="flex-row items-center gap-3 bg-muted rounded-xl p-3"
            >
              <ProviderIcon tool={tool} size={28} />
              <View className="flex-1">
                <Text className="text-foreground font-semibold text-sm">{TOOL_LABELS[tool]}</Text>
                {isInstalled && info.version && (
                  <Text className="text-muted-foreground text-xs">{info.version}</Text>
                )}
              </View>
              {detecting && !detectedTools ? (
                <ActivityIndicator size="small" color={accent} />
              ) : isInstalled ? (
                <View className="flex-row items-center gap-1">
                  <Icon name="check-circle" size={14} color={success} />
                  <Text className="text-success text-xs font-semibold">Installed</Text>
                </View>
              ) : detectedTools ? (
                <View className="flex-row items-center gap-1">
                  <Icon name="x-circle" size={14} color={destructive} />
                  <Text className="text-destructive text-xs font-semibold">Not Installed</Text>
                </View>
              ) : (
                <ActivityIndicator size="small" color={accent} />
              )}
            </View>
          );
        })}
      </SectionCard>

      {/* Readiness Report */}
      {readiness && (
        <SectionCard title="Readiness Report">
          <StatePill value={readiness.readiness} />
          <Text className="text-muted-foreground text-sm">OS: {readiness.os} {readiness.distro} {readiness.distroVersion}</Text>
          <Text className="text-muted-foreground text-sm">Arch: {readiness.arch}</Text>
          <Text className="text-muted-foreground text-sm">Shell: {readiness.shell}</Text>
          <Text className="text-muted-foreground text-sm">Package Manager: {readiness.packageManager}</Text>
          <Text className="text-muted-foreground text-sm">
            Prerequisites: Node {readiness.prerequisites.node ? "\u2713" : "\u2717"} | npm{" "}
            {readiness.prerequisites.npm ? "\u2713" : "\u2717"} | git{" "}
            {readiness.prerequisites.git ? "\u2713" : "\u2717"} | curl{" "}
            {readiness.prerequisites.curl ? "\u2713" : "\u2717"}
          </Text>
          {readiness.notes.length > 0 && (
            <Text className="text-dimmed text-[13px]">{readiness.notes.join("\n")}</Text>
          )}
        </SectionCard>
      )}

      {/* Quick Links */}
      <View className="flex-row gap-3">
        <Pressable
          className="flex-1 bg-card border border-border rounded-2xl p-3.5 items-center active:opacity-80"
          onPress={() => navigation.navigate("FileBrowser", { targetId })}
        >
          <Text className="text-accent font-semibold text-sm">Browse Files</Text>
        </Pressable>
        <Pressable
          className="flex-1 bg-card border border-border rounded-2xl p-3.5 items-center active:opacity-80"
          onPress={() => navigation.navigate("Terminal", { targetId })}
        >
          <Text className="text-accent font-semibold text-sm">Terminal</Text>
        </Pressable>
      </View>

      {/* Delete */}
      <Pressable className="bg-error-bg rounded-2xl p-3.5 items-center" onPress={handleDelete}>
        <Text className="text-destructive font-semibold text-[15px]">Delete Host</Text>
      </Pressable>
    </ScrollView>
  );
}
