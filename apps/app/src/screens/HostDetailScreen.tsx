import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { formatRelativeTime } from "../core/formatTime";
import type { WorkspaceChatInfo } from "../core/ai/DaemonTransport";

type Props = NativeStackScreenProps<MainStackParamList, "HostDetail">;

const TOOLS = ["claude", "codex", "gemini"] as const;

const TOOL_LABELS: Record<ToolName, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
};

function basename(input?: string): string {
  if (!input) return "";
  const trimmed = input.trim().replace(/\/+$/g, "");
  if (!trimmed) return "";
  const parts = trimmed.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? trimmed;
}

function discoveredSessionKey(session: WorkspaceChatInfo): string {
  return session.daemonSessionId ? `daemon:${session.daemonSessionId}` : `${session.tool}:${session.resumeId}`;
}

function discoveredSessionTitle(session: WorkspaceChatInfo): string {
  const title = session.title?.trim();
  if (title) return title.slice(0, 96);
  const summary = session.summary?.trim();
  if (summary) return summary.slice(0, 96);
  const folder = basename(session.workingDirectory);
  if (folder) return `${TOOL_LABELS[session.tool]} · ${folder}`;
  return `${TOOL_LABELS[session.tool]} session`;
}

export function HostDetailScreen({ route, navigation }: Props): JSX.Element {
  const { targetId } = route.params;
  const {
    getTarget,
    deleteTarget,
    runCliDetection,
    subscribeRun,
    startDaemonInstall,
    readinessByTarget,
    listDiscoveredSessions,
    openDiscoveredSession,
    sessions,
  } = useAppStore();

  const { accent, success, destructive, primaryForeground } = useThemeColors();
  const target = getTarget(targetId);
  const [detecting, setDetecting] = useState(false);
  const [installingDaemon, setInstallingDaemon] = useState(false);
  const [daemonInstallStatus, setDaemonInstallStatus] = useState<string>("");
  const [discoveringSessions, setDiscoveringSessions] = useState(false);
  const [openingSessionKey, setOpeningSessionKey] = useState<string | null>(null);
  const [discoveredSessions, setDiscoveredSessions] = useState<WorkspaceChatInfo[]>([]);
  const [discoveredSessionsError, setDiscoveredSessionsError] = useState("");
  const readiness = readinessByTarget[targetId];

  const isBridge = target?.connectionType === "bridge";

  const handleDetectTools = useCallback(async (): Promise<void> => {
    if (detecting || isBridge) return;
    setDetecting(true);
    try {
      await runCliDetection(targetId);
    } catch {
      // CLI detection failed — no-op
    }
    setDetecting(false);
  }, [detecting, isBridge, runCliDetection, targetId]);

  // Always auto-detect on mount to ensure fresh tool status (SSH hosts only)
  useEffect(() => {
    if (!target || isBridge) return;
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

      const TERMINAL = ["completed", "failed", "cancelled", "timeout"];

      // Run may already be finalized if it timed out while queued behind another SSH command
      if (!TERMINAL.includes(run.status)) {
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

            if (TERMINAL.includes(updatedRun.status)) {
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
      } else if (run.status !== "completed") {
        const lastEvent = run.events[run.events.length - 1];
        setDaemonInstallStatus(lastEvent?.message ?? `Install ${run.status}`);
      }

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

  const importedSessionIds = useMemo(() => {
    const imported = new Set<string>();
    for (const session of sessions) {
      if (session.targetId !== targetId) continue;
      if (session.daemonSessionId) {
        imported.add(`daemon:${session.daemonSessionId}`);
      }
      if (session.conversationId) {
        imported.add(`${session.tool}:${session.conversationId}`);
      }
    }
    return imported;
  }, [sessions, targetId]);

  const loadDiscoveredSessions = useCallback(async (): Promise<void> => {
    if (!target) return;
    if (!isBridge && !daemonReady) {
      setDiscoveredSessions([]);
      setDiscoveredSessionsError("");
      return;
    }

    setDiscoveringSessions(true);
    setDiscoveredSessionsError("");
    try {
      const next = await listDiscoveredSessions(targetId);
      setDiscoveredSessions(next);
    } catch (error) {
      setDiscoveredSessions([]);
      setDiscoveredSessionsError(error instanceof Error ? error.message : "Failed to load sessions");
    } finally {
      setDiscoveringSessions(false);
    }
  }, [daemonReady, isBridge, listDiscoveredSessions, target, targetId]);

  useEffect(() => {
    if (!target) return;
    void loadDiscoveredSessions();
  }, [loadDiscoveredSessions, target]);

  const handleRefresh = useCallback(async (): Promise<void> => {
    await Promise.all([
      handleDetectTools(),
      loadDiscoveredSessions(),
    ]);
  }, [handleDetectTools, loadDiscoveredSessions]);

  const handleOpenDiscoveredSession = useCallback(async (sessionInfo: WorkspaceChatInfo): Promise<void> => {
    const key = discoveredSessionKey(sessionInfo);
    setOpeningSessionKey(key);
    try {
      const session = await openDiscoveredSession(targetId, sessionInfo.id);
      navigation.navigate("AiChat", { sessionId: session.id });
      void loadDiscoveredSessions();
    } catch (error) {
      Alert.alert(
        "Open Session Failed",
        error instanceof Error ? error.message : "Unable to open this session.",
      );
    } finally {
      setOpeningSessionKey(null);
    }
  }, [loadDiscoveredSessions, navigation, openDiscoveredSession, targetId]);

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={detecting || discoveringSessions}
          onRefresh={handleRefresh}
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
        {isBridge ? (
          <>
            <Text className="text-muted-foreground text-sm">Bridge: {target.bridgeUrl}</Text>
            <Text className="text-muted-foreground text-sm">Connection: Bridge (HTTPS)</Text>
          </>
        ) : (
          <>
            <Text className="text-muted-foreground text-sm">
              {target.username}@{target.host}:{target.port}
            </Text>
            <Text className="text-muted-foreground text-sm">Auth: {target.authMethod}</Text>
          </>
        )}
        {target.lastStatusReason && (
          <Text className="text-warning text-[13px]">{target.lastStatusReason}</Text>
        )}
      </SectionCard>

      {/* Daemon Status — SSH hosts only */}
      {!isBridge && <SectionCard title="Open Vide Daemon">
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
                <ActivityIndicator size="small" color={primaryForeground} />
              ) : (
                <Text className="text-primary-foreground font-semibold text-xs">{daemonCtaLabel}</Text>
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
      </SectionCard>}

      {/* CLI Tools — SSH hosts only */}
      {!isBridge && <SectionCard title="CLI Tools">
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
      </SectionCard>}

      {/* Readiness Report — SSH hosts only */}
      {!isBridge && readiness && (
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

      <SectionCard title="Ongoing Sessions">
        {!isBridge && !daemonReady ? (
          <Text className="text-warning text-[13px]">
            Install a compatible daemon on this host to discover ongoing CLI sessions.
          </Text>
        ) : discoveringSessions && discoveredSessions.length === 0 ? (
          <View className="py-2">
            <ActivityIndicator size="small" color={accent} />
          </View>
        ) : discoveredSessionsError ? (
          <Text className="text-warning text-[13px]">{discoveredSessionsError}</Text>
        ) : discoveredSessions.length === 0 ? (
          <Text className="text-muted-foreground text-sm">
            No ongoing sessions were found on this host.
          </Text>
        ) : (
          discoveredSessions.map((sessionInfo) => {
            const key = discoveredSessionKey(sessionInfo);
            const isImported = importedSessionIds.has(key) || importedSessionIds.has(`${sessionInfo.tool}:${sessionInfo.resumeId}`);
            const isOpening = openingSessionKey === key;
            const updatedAt = sessionInfo.updatedAt ?? sessionInfo.createdAt;
            const folder = basename(sessionInfo.workingDirectory);

            return (
              <Pressable
                key={key}
                className="bg-muted rounded-xl p-3 gap-2 active:opacity-80"
                onPress={() => void handleOpenDiscoveredSession(sessionInfo)}
                disabled={isOpening}
              >
                <View className="flex-row items-center justify-between gap-3">
                  <View className="flex-row items-center gap-3 flex-1">
                    <ProviderIcon tool={sessionInfo.tool} size={22} />
                    <View className="flex-1 gap-0.5">
                      <Text className="text-foreground font-semibold text-sm" numberOfLines={2}>
                        {discoveredSessionTitle(sessionInfo)}
                      </Text>
                      <Text className="text-muted-foreground text-xs" numberOfLines={1}>
                        {[folder, updatedAt ? formatRelativeTime(updatedAt) : undefined].filter(Boolean).join(" · ")}
                      </Text>
                    </View>
                  </View>
                  <View className="items-end gap-1">
                    {isOpening ? (
                      <ActivityIndicator size="small" color={accent} />
                    ) : (
                      <Text className="text-accent text-xs font-semibold">
                        {isImported ? "Open" : "Import"}
                      </Text>
                    )}
                    <Text
                      className={cn(
                        "text-[11px] font-semibold uppercase",
                        sessionInfo.status === "running" && "text-accent",
                        sessionInfo.status === "failed" && "text-destructive",
                        (sessionInfo.status === "cancelled" || sessionInfo.status === "interrupted") && "text-warning",
                        (sessionInfo.status === "idle") && "text-dimmed",
                      )}
                    >
                      {sessionInfo.status}
                    </Text>
                  </View>
                </View>
                {sessionInfo.summary ? (
                  <Text className="text-dimmed text-xs" numberOfLines={2}>
                    {sessionInfo.summary}
                  </Text>
                ) : null}
              </Pressable>
            );
          })
        )}
      </SectionCard>

      {/* Quick Links — SSH hosts only (Terminal/FileBrowser need SSH) */}
      {!isBridge && (
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
      )}

      {/* Delete */}
      <Pressable className="bg-error-bg rounded-2xl p-3.5 items-center" onPress={handleDelete}>
        <Text className="text-destructive font-semibold text-[15px]">Delete Host</Text>
      </Pressable>
    </ScrollView>
  );
}
