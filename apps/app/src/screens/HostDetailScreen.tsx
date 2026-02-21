import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppStore } from "../state/AppStoreContext";
import { SectionCard } from "../components/SectionCard";
import { StatePill } from "../components/StatePill";
import { HostStatusDot } from "../components/HostStatusDot";
import { ProviderIcon } from "../components/ProviderIcon";
import { SessionCard } from "../components/SessionCard";
import { SwipeableRow } from "../components/SwipeableRow";
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
    deleteSession,
    runCliDetection,
    startToolRun,
    subscribeRun,
    installDaemon,
    importDaemonSessions,
    readinessByTarget,
    listSessionsByTarget,
  } = useAppStore();

  const { accent, success } = useThemeColors();
  const target = getTarget(targetId);
  const [detecting, setDetecting] = useState(false);
  const [installingTool, setInstallingTool] = useState<ToolName | null>(null);
  const [installingDaemon, setInstallingDaemon] = useState(false);
  const [importingSessions, setImportingSessions] = useState(false);
  const readiness = readinessByTarget[targetId];
  const sessions = listSessionsByTarget(targetId);

  const handleDetectTools = useCallback(async (): Promise<void> => {
    if (detecting) return;
    setDetecting(true);
    try {
      await runCliDetection(targetId);
    } catch (err) {
      console.warn("[OV:ui] HostDetail: CLI detection failed:", err);
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

  const handleInstallTool = async (tool: ToolName): Promise<void> => {
    setInstallingTool(tool);
    try {
      const run = await startToolRun({
        targetId,
        tool,
        action: "install",
        timeoutSec: 120,
      });

      await new Promise<void>((resolve) => {
        const unsub = subscribeRun(run.id, (updatedRun) => {
          if (["completed", "failed", "cancelled", "timeout"].includes(updatedRun.status)) {
            unsub();
            resolve();
          }
        });
      });

      // Re-detect after install
      await runCliDetection(targetId);
    } catch (err) {
      console.warn("[OV:ui] HostDetail: install failed:", err);
    }
    setInstallingTool(null);
  };

  const handleInstallDaemon = async (): Promise<void> => {
    setInstallingDaemon(true);
    try {
      await installDaemon(targetId);
    } catch (err) {
      console.warn("[OV:ui] HostDetail: daemon install failed:", err);
    }
    setInstallingDaemon(false);
  };

  const handleImportSessions = async (): Promise<void> => {
    if (importingSessions) return;
    setImportingSessions(true);
    try {
      const imported = await importDaemonSessions(targetId);
      if (imported.length === 0) {
        Alert.alert("No Sessions", "No new daemon sessions available to import.");
      } else {
        Alert.alert("Imported", `Imported ${imported.length} session${imported.length === 1 ? "" : "s"} from the daemon.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert("Import Failed", msg);
    }
    setImportingSessions(false);
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
              disabled={installingDaemon || installingTool !== null}
            >
              {installingDaemon ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text className="text-white font-semibold text-xs">{daemonCtaLabel}</Text>
              )}
            </Pressable>
          )}
        </View>
        {!detecting && !daemonInstalled && (
          <Text className="text-warning text-[13px]">
            Daemon is required to start AI sessions. Install it to continue.
          </Text>
        )}
        {!detecting && daemonInstalled && !daemonCompatible && (
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
          const isInstalling = installingTool === tool;

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
              ) : !detectedTools ? (
                <ActivityIndicator size="small" color={accent} />
              ) : (
                <Pressable
                  className={cn("bg-accent px-3 py-1.5 rounded-lg", isInstalling && "opacity-40")}
                  onPress={() => handleInstallTool(tool)}
                  disabled={isInstalling || installingTool !== null}
                >
                  {isInstalling ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text className="text-white font-semibold text-xs">Install</Text>
                  )}
                </Pressable>
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
      <Pressable
        className="bg-card border border-border rounded-2xl p-3.5 items-center active:opacity-80"
        onPress={() => navigation.navigate("PortBrowser", { targetId })}
      >
        <Text className="text-accent font-semibold text-sm">Scan Open Ports</Text>
      </Pressable>

      {/* Recent Sessions */}
      <SectionCard title="Recent Sessions">
        {sessions.length > 0 ? (
          sessions.slice(0, 5).map((session) => (
            <SwipeableRow
              key={session.id}
              onDelete={() => void deleteSession(session.id)}
              confirmTitle="Delete Session"
              confirmMessage="Delete this session? This cannot be undone."
            >
              <SessionCard
                session={session}
                hostLabel={target.label}
                onPress={() => {
                  navigation.navigate("AiChat", { sessionId: session.id });
                }}
              />
            </SwipeableRow>
          ))
        ) : (
          <Text className="text-muted-foreground text-sm">No sessions yet</Text>
        )}
        {daemonInstalled && (
          <Pressable
            className={cn("flex-row items-center justify-center gap-2 bg-muted rounded-xl py-3 mt-1 active:opacity-80", importingSessions && "opacity-40")}
            onPress={handleImportSessions}
            disabled={importingSessions}
          >
            {importingSessions ? (
              <ActivityIndicator size="small" color={accent} />
            ) : (
              <Icon name="download" size={16} color={accent} />
            )}
            <Text className="text-accent font-semibold text-sm">Import Daemon Sessions</Text>
          </Pressable>
        )}
      </SectionCard>

      {/* Delete */}
      <Pressable className="bg-error-bg rounded-2xl p-3.5 items-center" onPress={handleDelete}>
        <Text className="text-destructive font-semibold text-[15px]">Delete Host</Text>
      </Pressable>
    </ScrollView>
  );
}
