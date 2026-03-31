import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, ScrollView, Switch, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppStore } from "../state/AppStoreContext";
import { GlassContainer } from "../components/GlassContainer";
import { Icon } from "../components/Icon";
import { ProviderIcon } from "../components/ProviderIcon";
import { SheetModal } from "../components/SheetModal";
import { useThemeColors } from "../constants/colors";
import type { ScheduledTask, ScheduleDraft, TeamInfo } from "../core/ai/Transport";
import type { MainStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<MainStackParamList, "Schedules">;
type Tool = "claude" | "codex" | "gemini";

type DraftState = {
  id?: string;
  targetId: string | null;
  name: string;
  schedule: string;
  project: string;
  enabled: boolean;
  targetKind: "prompt" | "team";
  tool: Tool;
  cwd: string;
  prompt: string;
  teamId: string;
  to: string;
};

const EMPTY_DRAFT: DraftState = {
  targetId: null,
  name: "",
  schedule: "",
  project: "",
  enabled: true,
  targetKind: "prompt",
  tool: "claude",
  cwd: "",
  prompt: "",
  teamId: "",
  to: "*",
};

export function SchedulesScreen({ navigation }: Props): JSX.Element {
  const {
    targets,
    getSchedules,
    getTeams,
    createSchedule,
    updateSchedule,
    deleteSchedule,
    runSchedule,
  } = useAppStore();
  const { success, dimmed, accent, foreground, mutedForeground, muted, primaryForeground } = useThemeColors();

  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const [togglingTaskId, setTogglingTaskId] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);

  const refresh = useCallback(async () => {
    try {
      const [scheduleItems, teamItems] = await Promise.all([getSchedules(), getTeams()]);
      setTasks(scheduleItems);
      setTeams(teamItems);
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getSchedules, getTeams]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!draft.targetId && targets.length > 0) {
      setDraft((current) => ({ ...current, targetId: targets[0]!.id }));
    }
  }, [draft.targetId, targets]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void refresh();
  }, [refresh]);

  const resetDraft = useCallback(() => {
    setDraft({
      ...EMPTY_DRAFT,
      targetId: targets[0]?.id ?? null,
    });
    setShowEditor(false);
    setSaving(false);
  }, [targets]);

  const handleOpenCreate = useCallback(() => {
    setDraft({
      ...EMPTY_DRAFT,
      targetId: targets[0]?.id ?? null,
    });
    setShowEditor(true);
  }, [targets]);

  const handleEdit = useCallback((task: ScheduledTask) => {
    setDraft({
      id: task.id,
      targetId: task.targetId ?? targets[0]?.id ?? null,
      name: task.name,
      schedule: task.schedule,
      project: task.project ?? "",
      enabled: task.enabled !== false,
      targetKind: task.target.kind,
      tool: (task.target.kind === "prompt" ? (task.target.tool as Tool | undefined) : undefined) ?? "claude",
      cwd: task.target.kind === "prompt" ? task.target.cwd ?? "" : task.project ?? "",
      prompt: task.target.prompt ?? "",
      teamId: task.target.kind === "team" ? task.target.teamId ?? "" : "",
      to: task.target.kind === "team" ? task.target.to ?? "*" : "*",
    });
    setShowEditor(true);
  }, [targets]);

  const handleDelete = useCallback((task: ScheduledTask) => {
    Alert.alert(
      "Delete Schedule",
      `Delete "${task.name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                await deleteSchedule(task.id, task.targetId);
                await refresh();
              } catch (err) {
                Alert.alert("Failed", err instanceof Error ? err.message : String(err));
              }
            })();
          },
        },
      ],
    );
  }, [deleteSchedule, refresh]);

  const handleRun = useCallback(async (taskId: string, taskName: string) => {
    setRunningTaskId(taskId);
    const startedAt = new Date().toISOString();
    setTasks((current) => current.map((task) => (
      task.id === taskId
        ? { ...task, lastStatus: "running", lastRun: startedAt }
        : task
    )));
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await runSchedule(taskId);
      Alert.alert("Started", `"${taskName}" is running`);
      await refresh();
    } catch (err) {
      await refresh();
      Alert.alert("Failed", err instanceof Error ? err.message : String(err));
    } finally {
      setRunningTaskId(null);
    }
  }, [refresh, runSchedule]);

  const handleToggleEnabled = useCallback(async (task: ScheduledTask) => {
    setTogglingTaskId(task.id);
    setTasks((current) => current.map((entry) => (
      entry.id === task.id ? { ...entry, enabled: task.enabled === false } : entry
    )));
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await updateSchedule(task.id, { enabled: task.enabled === false }, task.targetId);
      await refresh();
    } catch (err) {
      await refresh();
      Alert.alert("Failed", err instanceof Error ? err.message : String(err));
    } finally {
      setTogglingTaskId(null);
    }
  }, [refresh, updateSchedule]);

  const availableTeams = useMemo(() => {
    return teams.filter((team) => !draft.targetId || team.targetId === draft.targetId);
  }, [draft.targetId, teams]);

  const selectedTeam = availableTeams.find((team) => team.id === draft.teamId);

  useEffect(() => {
    if (draft.targetKind !== "team") return;
    if (draft.teamId && availableTeams.some((team) => team.id === draft.teamId)) return;
    setDraft((current) => ({
      ...current,
      teamId: availableTeams[0]?.id ?? "",
      to: "*",
    }));
  }, [availableTeams, draft.targetKind, draft.teamId]);

  const buildScheduleDraft = useCallback((): ScheduleDraft | null => {
    if (!draft.name.trim() || !draft.schedule.trim() || !draft.prompt.trim()) return null;
    if (draft.targetKind === "team") {
      if (!draft.teamId) return null;
      return {
        name: draft.name.trim(),
        schedule: draft.schedule.trim(),
        project: draft.project.trim() || undefined,
        enabled: draft.enabled,
        target: {
          kind: "team",
          teamId: draft.teamId,
          prompt: draft.prompt.trim(),
          to: draft.to || "*",
        },
      };
    }

    if (!draft.cwd.trim()) return null;
    return {
      name: draft.name.trim(),
      schedule: draft.schedule.trim(),
      project: draft.project.trim() || undefined,
      enabled: draft.enabled,
      target: {
        kind: "prompt",
        tool: draft.tool,
        cwd: draft.cwd.trim(),
        prompt: draft.prompt.trim(),
      },
    };
  }, [draft]);

  const canSave = useMemo(() => {
    return buildScheduleDraft() !== null && !!draft.targetId && !saving;
  }, [buildScheduleDraft, draft.targetId, saving]);

  const handleSave = useCallback(async () => {
    const payload = buildScheduleDraft();
    if (!payload || !draft.targetId) return;
    setSaving(true);
    try {
      if (draft.id) {
        await updateSchedule(draft.id, payload, draft.targetId);
      } else {
        await createSchedule(draft.targetId, payload);
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      resetDraft();
      await refresh();
    } catch (err) {
      Alert.alert("Failed", err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }, [buildScheduleDraft, createSchedule, draft.id, draft.targetId, refresh, resetDraft, updateSchedule]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View className="flex-row items-center gap-1">
          <Pressable
            onPress={handleRefresh}
            className="w-10 h-10 items-center justify-center active:opacity-80"
          >
            <Icon name="refresh-cw" size={18} color={dimmed} />
          </Pressable>
          <Pressable
            onPress={handleOpenCreate}
            className="w-10 h-10 items-center justify-center active:opacity-80"
          >
            <Icon name="plus" size={18} color={accent} />
          </Pressable>
        </View>
      ),
    });
  }, [accent, dimmed, handleOpenCreate, handleRefresh, navigation]);

  if (loading) {
    return (
      <View className="flex-1 bg-background justify-center items-center">
        <ActivityIndicator size="small" />
      </View>
    );
  }

  const renderChip = (
    label: string,
    selected: boolean,
    onPress: () => void,
    leading?: React.ReactNode,
  ) => (
    <Pressable
      key={label}
      onPress={onPress}
      className="px-3 py-2 rounded-full active:opacity-80 flex-row items-center gap-2"
      style={{ backgroundColor: selected ? accent : "rgba(255,255,255,0.06)" }}
    >
      {leading}
      <Text style={{ color: selected ? primaryForeground : foreground }}>{label}</Text>
    </Pressable>
  );

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={tasks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        renderItem={({ item }) => {
          const teamTargetId = item.target.kind === "team" ? item.target.teamId : undefined;
          const targetLabel = item.target.kind === "team"
            ? teams.find((team) => team.id === teamTargetId)?.name ?? teamTargetId ?? "Unknown team"
            : `${item.target.tool?.toUpperCase() ?? "AI"} · ${item.target.cwd ?? item.project ?? "—"}`;
          return (
            <GlassContainer variant="card" className="p-4 gap-2.5">
              <View className="flex-row items-center justify-between gap-3">
                <View className="flex-1">
                  <Text className="text-foreground text-[15px] font-semibold" numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text className="text-dimmed text-xs mt-1" numberOfLines={1}>
                    {item.targetLabel ? `${item.targetLabel} · ` : ""}{item.schedule}
                  </Text>
                </View>
                <View
                  className="rounded-full px-2.5 py-1"
                  style={{ backgroundColor: item.enabled === false ? muted : "rgba(70, 210, 130, 0.18)" }}
                >
                  <Text className="text-[10px] font-semibold" style={{ color: item.enabled === false ? dimmed : success }}>
                    {item.enabled === false ? "OFF" : (item.lastStatus ?? "ON").toUpperCase()}
                  </Text>
                </View>
              </View>

              <View className="flex-row items-center gap-2">
                {item.target.kind === "prompt" && (item.target.tool === "claude" || item.target.tool === "codex") ? (
                  <ProviderIcon tool={item.target.tool} size={14} />
                ) : (
                  <Icon name={item.target.kind === "team" ? "users" : "terminal"} size={12} color={dimmed} />
                )}
                <Text className="text-dimmed text-xs flex-1" numberOfLines={1}>{targetLabel}</Text>
              </View>

              {item.nextRun ? (
                <Text className="text-dimmed text-[11px]">Next: {item.nextRun}</Text>
              ) : null}
              {item.lastRun || item.lastError ? (
                <Text className="text-dimmed text-[11px]">
                  Last: {item.lastRun ?? "—"}{item.lastError ? ` · ${item.lastError}` : ""}
                </Text>
              ) : null}

              <View className="flex-row items-center gap-2 pt-1">
                <Pressable
                  onPress={() => void handleRun(item.id, item.name)}
                  disabled={runningTaskId === item.id}
                  className="w-9 h-9 rounded-full items-center justify-center active:opacity-80"
                  style={{ backgroundColor: "#000" }}
                >
                  {runningTaskId === item.id ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Icon name="navigation" size={14} color="#fff" />
                  )}
                </Pressable>
                <Pressable
                  onPress={() => handleEdit(item)}
                  className="w-9 h-9 rounded-full items-center justify-center active:opacity-80"
                  style={{ backgroundColor: "rgba(255,255,255,0.06)" }}
                >
                  <Icon name="edit-2" size={14} color={foreground} />
                </Pressable>
                <Pressable
                  onPress={() => void handleToggleEnabled(item)}
                  disabled={togglingTaskId === item.id}
                  className="w-9 h-9 rounded-full items-center justify-center active:opacity-80"
                  style={{ backgroundColor: "#000" }}
                >
                  {togglingTaskId === item.id ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Icon name={item.enabled === false ? "play" : "pause"} size={14} color="#fff" />
                  )}
                </Pressable>
                <Pressable
                  onPress={() => handleDelete(item)}
                  className="w-9 h-9 rounded-full items-center justify-center active:opacity-80"
                  style={{ backgroundColor: "#d64545" }}
                >
                  <Icon name="trash-2" size={14} color="#fff" />
                </Pressable>
              </View>
            </GlassContainer>
          );
        }}
        ListEmptyComponent={
          <View className="items-center py-12 gap-3">
            <Icon name="calendar" size={32} color={dimmed} />
            <Text className="text-dimmed text-sm text-center">No scheduled tasks</Text>
            <Text className="text-dimmed text-xs text-center px-8">
              Create prompt or team schedules that run through the shared daemon.
            </Text>
          </View>
        }
      />

      <SheetModal visible={showEditor} onClose={resetDraft}>
        <ScrollView contentContainerStyle={{ gap: 16 }}>
          <Text className="text-foreground text-[17px] font-semibold">
            {draft.id ? "Edit Schedule" : "New Schedule"}
          </Text>

          <View className="gap-2">
            <Text className="text-dimmed text-xs">Host</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {targets.map((target) => renderChip(target.label, draft.targetId === target.id, () => setDraft((current) => ({ ...current, targetId: target.id })), <Icon name="server" size={12} color={draft.targetId === target.id ? primaryForeground : dimmed} />))}
            </ScrollView>
          </View>

          <View className="gap-2">
            <Text className="text-dimmed text-xs">Schedule Name</Text>
            <TextInput
              className="bg-muted rounded-2xl px-4 py-3 text-foreground"
              value={draft.name}
              onChangeText={(value) => setDraft((current) => ({ ...current, name: value }))}
              placeholder="Daily standup summary"
              placeholderTextColor={mutedForeground}
            />
          </View>

          <View className="gap-2">
            <Text className="text-dimmed text-xs">Cron Expression</Text>
            <TextInput
              className="bg-muted rounded-2xl px-4 py-3 text-foreground"
              value={draft.schedule}
              onChangeText={(value) => setDraft((current) => ({ ...current, schedule: value }))}
              placeholder="0 9 * * 1-5"
              placeholderTextColor={mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1 shrink">
              <Text className="text-foreground text-[15px]">Enabled</Text>
              <Text className="text-dimmed text-xs mt-0.5">
                Disabled schedules stay saved but do not auto-run
              </Text>
            </View>
            <Switch
              value={draft.enabled}
              onValueChange={(value) => setDraft((current) => ({ ...current, enabled: value }))}
              trackColor={{ false: muted, true: accent }}
            />
          </View>

          <View className="gap-2">
            <Text className="text-dimmed text-xs">Target Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {renderChip("Prompt Session", draft.targetKind === "prompt", () => setDraft((current) => ({ ...current, targetKind: "prompt" })), <Icon name="terminal" size={12} color={draft.targetKind === "prompt" ? primaryForeground : dimmed} />)}
              {renderChip("Team Dispatch", draft.targetKind === "team", () => setDraft((current) => ({ ...current, targetKind: "team" })), <Icon name="users" size={12} color={draft.targetKind === "team" ? primaryForeground : dimmed} />)}
            </ScrollView>
          </View>

          {draft.targetKind === "prompt" ? (
            <>
              <View className="gap-2">
                <Text className="text-dimmed text-xs">Tool</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {(["claude", "codex"] as Tool[]).map((tool) =>
                    renderChip(
                      tool,
                      draft.tool === tool,
                      () => setDraft((current) => ({ ...current, tool })),
                      tool === "claude" || tool === "codex" ? <ProviderIcon tool={tool} size={14} /> : <Icon name="cpu" size={12} color={draft.tool === tool ? primaryForeground : dimmed} />,
                    ),
                  )}
                </ScrollView>
              </View>

              <View className="gap-2">
                <Text className="text-dimmed text-xs">Working Directory</Text>
                <TextInput
                  className="bg-muted rounded-2xl px-4 py-3 text-foreground"
                  value={draft.cwd}
                  onChangeText={(value) => setDraft((current) => ({ ...current, cwd: value }))}
                  placeholder="~/projects/openvide"
                  placeholderTextColor={mutedForeground}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            </>
          ) : (
            <>
              <View className="gap-2">
                <Text className="text-dimmed text-xs">Team</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {availableTeams.length > 0 ? availableTeams.map((team) =>
                    renderChip(team.name, draft.teamId === team.id, () => setDraft((current) => ({ ...current, teamId: team.id, to: "*" })), <Icon name="users" size={12} color={draft.teamId === team.id ? primaryForeground : dimmed} />),
                  ) : (
                    <Text className="text-dimmed text-xs">No teams on selected host</Text>
                  )}
                </ScrollView>
              </View>

              {selectedTeam ? (
                <View className="gap-2">
                  <Text className="text-dimmed text-xs">Recipient</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {renderChip("All", draft.to === "*", () => setDraft((current) => ({ ...current, to: "*" })), <Icon name="send" size={12} color={draft.to === "*" ? primaryForeground : dimmed} />)}
                    {selectedTeam.members.map((member) =>
                      renderChip(
                        member.name,
                        draft.to === member.name,
                        () => setDraft((current) => ({ ...current, to: member.name })),
                        member.tool === "claude" || member.tool === "codex"
                          ? <ProviderIcon tool={member.tool} size={14} />
                          : <Icon name="user" size={12} color={draft.to === member.name ? primaryForeground : dimmed} />,
                      ),
                    )}
                  </ScrollView>
                </View>
              ) : null}
            </>
          )}

          <View className="gap-2">
            <Text className="text-dimmed text-xs">Project Label</Text>
            <TextInput
              className="bg-muted rounded-2xl px-4 py-3 text-foreground"
              value={draft.project}
              onChangeText={(value) => setDraft((current) => ({ ...current, project: value }))}
              placeholder="even-realities"
              placeholderTextColor={mutedForeground}
            />
          </View>

          <View className="gap-2">
            <Text className="text-dimmed text-xs">Prompt</Text>
            <TextInput
              className="bg-muted rounded-2xl px-4 py-3 text-foreground min-h-[120px]"
              value={draft.prompt}
              onChangeText={(value) => setDraft((current) => ({ ...current, prompt: value }))}
              placeholder="What should run on this schedule?"
              placeholderTextColor={mutedForeground}
              multiline
              textAlignVertical="top"
            />
          </View>

          <Pressable
            onPress={() => void handleSave()}
            disabled={!canSave}
            className="rounded-full py-4 items-center active:opacity-80"
            style={{ backgroundColor: canSave ? accent : "rgba(255,255,255,0.14)" }}
          >
            <Text style={{ color: canSave ? primaryForeground : mutedForeground }}>
              {saving ? "Saving..." : draft.id ? "Save Changes" : "Create Schedule"}
            </Text>
          </Pressable>
        </ScrollView>
      </SheetModal>
    </View>
  );
}
