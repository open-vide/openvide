import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppStore } from "../state/AppStoreContext";
import { GlassContainer } from "../components/GlassContainer";
import { Icon } from "../components/Icon";
import { ProviderIcon } from "../components/ProviderIcon";
import { SheetModal } from "../components/SheetModal";
import { SwipeableRow } from "../components/SwipeableRow";
import { useThemeColors } from "../constants/colors";
import type { TeamInfo, TeamTaskInfo, TeamPlanInfo, TeamMemberInput } from "../core/ai/Transport";
import type { MainStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<MainStackParamList, "TeamDetail">;

type TabId = "board" | "plan" | "chat";

const COLUMNS = ["todo", "in_progress", "done", "review", "approved"] as const;
const COLUMN_LABELS: Record<string, string> = {
  todo: "Todo",
  in_progress: "In Progress",
  done: "Done",
  review: "Review",
  approved: "Approved",
};
const TOOLS: Array<TeamMemberInput["tool"]> = ["claude", "codex"];
const ROLES: Array<TeamMemberInput["role"]> = ["lead", "planner", "coder", "reviewer"];

export function TeamDetailScreen({ navigation, route }: Props): JSX.Element {
  const { teamId } = route.params;
  const {
    getTeam,
    updateTeam,
    getTeamTasks,
    createTeamTask,
    updateTeamTask,
    getLatestTeamPlan,
    generateTeamPlan,
    deleteTeamPlan,
  } = useAppStore();
  const { dimmed, accent, foreground, mutedForeground, primaryForeground, success } = useThemeColors();

  const [team, setTeam] = useState<TeamInfo | null>(null);
  const [tasks, setTasks] = useState<TeamTaskInfo[]>([]);
  const [plan, setPlan] = useState<TeamPlanInfo | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("board");
  const [loading, setLoading] = useState(true);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [showTeamForm, setShowTeamForm] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [planRequest, setPlanRequest] = useState("");
  const [planMode, setPlanMode] = useState<"simple" | "consensus">("simple");
  const [planMaxIterations, setPlanMaxIterations] = useState(5);
  const [editName, setEditName] = useState("");
  const [editCwd, setEditCwd] = useState("");
  const [editMembers, setEditMembers] = useState<TeamMemberInput[]>([]);
  const [addingTask, setAddingTask] = useState(false);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [savingTeam, setSavingTeam] = useState(false);
  const [deletingPlan, setDeletingPlan] = useState(false);

  const refreshTeam = useCallback(async () => {
    try {
      const item = await getTeam(teamId);
      setTeam(item);
      setEditName(item.name);
      setEditCwd(item.workingDirectory);
      setEditMembers(item.members.map((member) => ({
        name: member.name,
        tool: member.tool,
        role: member.role,
        model: member.model,
      })));
      if (!newOwner && item.members.length > 0) {
        setNewOwner(item.members[0]!.name);
      }
      navigation.setOptions({ title: item.name });
    } catch {
      // ignore
    }
  }, [getTeam, navigation, newOwner, teamId]);

  const refreshTasks = useCallback(async () => {
    try {
      const item = await getTeamTasks(teamId);
      setTasks(item);
    } catch {
      // ignore
    }
  }, [getTeamTasks, teamId]);

  const refreshPlan = useCallback(async () => {
    try {
      const item = await getLatestTeamPlan(teamId);
      setPlan(item);
    } catch {
      setPlan(null);
    }
  }, [getLatestTeamPlan, teamId]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshTeam(), refreshTasks(), refreshPlan()]);
    setLoading(false);
  }, [refreshPlan, refreshTasks, refreshTeam]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    const timer = setInterval(() => {
      void refreshAll();
    }, 4000);
    return () => clearInterval(timer);
  }, [refreshAll]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View className="flex-row items-center gap-1">
          <Pressable
            onPress={() => void refreshAll()}
            className="w-10 h-10 items-center justify-center active:opacity-80"
          >
            <Icon name="refresh-cw" size={18} color={dimmed} />
          </Pressable>
          <Pressable
            onPress={() => setActiveTab((current) => {
              if (current === "plan") {
                setShowPlanForm(true);
                return current;
              }
              setShowTaskForm(true);
              return current;
            })}
            className="w-10 h-10 items-center justify-center active:opacity-80"
          >
            <Icon name="plus" size={18} color={accent} />
          </Pressable>
        </View>
      ),
    });
  }, [accent, dimmed, navigation, refreshAll]);

  const handleTaskPress = useCallback((task: TeamTaskInfo) => {
    const moveOptions = COLUMNS.filter((column) => column !== task.status).map((column) => ({
      text: COLUMN_LABELS[column],
      onPress: async () => {
        try {
          await updateTeamTask(teamId, task.id, { status: column });
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          await refreshTasks();
        } catch (err) {
          Alert.alert("Failed", err instanceof Error ? err.message : String(err));
        }
      },
    }));

    Alert.alert(
      task.subject,
      task.description || `Owner: ${task.owner}\nStatus: ${COLUMN_LABELS[task.status] ?? task.status}`,
      [...moveOptions, { text: "Cancel", style: "cancel" }],
    );
  }, [refreshTasks, teamId, updateTeamTask]);

  const handleAddTask = useCallback(async () => {
    if (!newSubject.trim() || !newOwner.trim()) return;
    setAddingTask(true);
    try {
      await createTeamTask(teamId, {
        subject: newSubject.trim(),
        description: newDescription.trim(),
        owner: newOwner.trim(),
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setShowTaskForm(false);
      setNewSubject("");
      setNewDescription("");
      await refreshTasks();
    } catch (err) {
      Alert.alert("Failed", err instanceof Error ? err.message : String(err));
    } finally {
      setAddingTask(false);
    }
  }, [createTeamTask, newDescription, newOwner, newSubject, refreshTasks, teamId]);

  const handleGeneratePlan = useCallback(async () => {
    if (!planRequest.trim()) return;
    setGeneratingPlan(true);
    try {
      await generateTeamPlan(teamId, planRequest.trim(), {
        mode: planMode,
        maxIterations: planMode === "consensus" ? planMaxIterations : undefined,
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setShowPlanForm(false);
      setPlanRequest("");
      await refreshPlan();
    } catch (err) {
      Alert.alert("Failed", err instanceof Error ? err.message : String(err));
    } finally {
      setGeneratingPlan(false);
    }
  }, [generateTeamPlan, planMaxIterations, planMode, planRequest, refreshPlan, teamId]);

  const handleSaveTeam = useCallback(async () => {
    const members = editMembers
      .map((member) => ({ ...member, name: member.name.trim() }))
      .filter((member) => member.name.length > 0);
    if (!editName.trim() || !editCwd.trim() || members.length === 0) return;
    setSavingTeam(true);
    try {
      await updateTeam(teamId, { name: editName.trim(), cwd: editCwd.trim(), members });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setShowTeamForm(false);
      await refreshAll();
    } catch (err) {
      Alert.alert("Failed", err instanceof Error ? err.message : String(err));
    } finally {
      setSavingTeam(false);
    }
  }, [editCwd, editMembers, editName, refreshAll, teamId, updateTeam]);

  const handleDeletePlan = useCallback(async () => {
    if (!plan) return;
    setDeletingPlan(true);
    try {
      await deleteTeamPlan(teamId, plan.id);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await refreshPlan();
    } catch (err) {
      Alert.alert("Failed", err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingPlan(false);
    }
  }, [deleteTeamPlan, plan, refreshPlan, teamId]);

  const tasksByStatus = useMemo(() => {
    const grouped: Record<string, TeamTaskInfo[]> = {};
    for (const column of COLUMNS) {
      grouped[column] = tasks.filter((task) => task.status === column);
    }
    return grouped;
  }, [tasks]);

  const latestRevision = plan?.revisions[plan.revisions.length - 1];

  if (loading) {
    return (
      <View className="flex-1 bg-background justify-center items-center">
        <ActivityIndicator size="small" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      {team ? (
        <GlassContainer variant="card" className="mx-4 mt-4 p-4 gap-2">
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1">
              <Text className="text-foreground text-[16px] font-semibold">{team.name}</Text>
              {team.targetLabel ? (
                <Text className="text-dimmed text-xs mt-1">{team.targetLabel}</Text>
              ) : null}
            </View>
            <View className="items-end gap-1">
              <Text className="text-dimmed text-xs">{team.members.length} members</Text>
              <Text className="text-dimmed text-xs">{tasks.length} tasks</Text>
              <Pressable onPress={() => setShowTeamForm(true)} className="w-8 h-8 items-center justify-center active:opacity-80">
                <Icon name="edit-3" size={14} color={accent} />
              </Pressable>
            </View>
          </View>
          <View className="flex-row items-center gap-1">
            <Icon name="folder" size={12} color={dimmed} />
            <Text className="text-dimmed text-xs flex-1" numberOfLines={1}>{team.workingDirectory}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {team.members.map((member) => (
              <View key={member.sessionId} className="flex-row items-center gap-1.5 bg-muted rounded-full px-2 py-1">
                {(member.tool === "claude" || member.tool === "codex") ? <ProviderIcon tool={member.tool} size={12} /> : null}
                <Text className="text-foreground text-[11px]">{member.name}</Text>
                <Text className="text-dimmed text-[10px]">{member.role}</Text>
              </View>
            ))}
          </ScrollView>
        </GlassContainer>
      ) : null}

      <View className="flex-row border-b border-border mt-4">
        {(["board", "plan", "chat"] as TabId[]).map((tab) => (
          <Pressable
            key={tab}
            onPress={() => {
              if (tab === "chat") {
                navigation.navigate("TeamChat", { teamId });
                return;
              }
              setActiveTab(tab);
            }}
            className="flex-1 items-center py-3"
            style={activeTab === tab ? { borderBottomWidth: 2, borderBottomColor: accent } : undefined}
          >
            <Text className="text-[13px] capitalize" style={{ color: activeTab === tab ? foreground : mutedForeground }}>
              {tab}
            </Text>
          </Pressable>
        ))}
      </View>

      {activeTab === "board" ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-1" contentContainerStyle={{ padding: 12, gap: 12 }}>
          {COLUMNS.map((column) => (
            <View key={column} className="bg-muted rounded-[6px] p-3" style={{ minWidth: 280 }}>
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-foreground text-[13px] font-semibold">{COLUMN_LABELS[column]}</Text>
                <Text className="text-dimmed text-[11px]">{(tasksByStatus[column] ?? []).length}</Text>
              </View>
              {(tasksByStatus[column] ?? []).map((task) => (
                <Pressable key={task.id} onPress={() => handleTaskPress(task)} className="mb-2 active:opacity-80">
                  <GlassContainer variant="card" className="p-3 gap-1.5">
                    <Text className="text-foreground text-[13px]" numberOfLines={2}>{task.subject}</Text>
                    <Text className="text-dimmed text-[11px]">{task.owner}</Text>
                    {task.comments.length > 0 ? (
                      <Text className="text-dimmed text-[10px]">{task.comments.length} comment{task.comments.length === 1 ? "" : "s"}</Text>
                    ) : null}
                  </GlassContainer>
                </Pressable>
              ))}
              {(tasksByStatus[column] ?? []).length === 0 ? (
                <Text className="text-dimmed text-[11px] text-center py-4 opacity-50">No tasks</Text>
              ) : null}
            </View>
          ))}
        </ScrollView>
      ) : null}

      {activeTab === "plan" ? (
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 12 }}>
          <Pressable
            onPress={() => setShowPlanForm(true)}
            className="rounded-full py-3 items-center active:opacity-80"
            style={{ backgroundColor: accent }}
          >
            <Text style={{ color: primaryForeground }}>Generate Plan</Text>
          </Pressable>

          {plan ? (
            <>
              <SwipeableRow
                onDelete={() => void handleDeletePlan()}
                confirmTitle="Delete Plan"
                confirmMessage={`Delete "${plan.id}"?`}
              >
                <GlassContainer variant="card" className="p-4 gap-2">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-foreground text-[15px] font-semibold">Latest Plan</Text>
                    <Text className="text-[11px] font-semibold" style={{ color: plan.status === "approved" ? success : foreground }}>
                      {deletingPlan ? "deleting" : plan.status}
                    </Text>
                  </View>
                  <Text className="text-dimmed text-xs">{plan.id}</Text>
                  <Text className="text-dimmed text-xs">
                    Mode: {plan.mode} · Iteration: {plan.iteration}/{plan.maxIterations}
                  </Text>
                  <Text className="text-dimmed text-xs">
                    Reviewers: {plan.reviewers.join(", ") || "None"}
                  </Text>
                  <Text className="text-dimmed text-xs">
                    Created by: {plan.createdBy}
                  </Text>
                </GlassContainer>
              </SwipeableRow>

              {latestRevision ? (
                <GlassContainer variant="card" className="p-4 gap-2">
                  <Text className="text-foreground text-[15px] font-semibold">Revision Tasks</Text>
                  {latestRevision.tasks.map((task: { subject: string; owner: string }, index: number) => (
                    <View key={`${task.subject}-${index}`} className="flex-row items-center gap-2">
                      <Text className="text-dimmed text-xs">{index + 1}.</Text>
                      <Text className="text-foreground text-[13px] flex-1">{task.subject}</Text>
                      <Text className="text-dimmed text-[11px]">{task.owner}</Text>
                    </View>
                  ))}
                </GlassContainer>
              ) : null}

              {plan.votes.length > 0 ? (
                <GlassContainer variant="card" className="p-4 gap-2">
                  <Text className="text-foreground text-[15px] font-semibold">Votes</Text>
                  {plan.votes.map((vote: { reviewer: string; vote: string; feedback?: string }, index: number) => (
                    <View key={`${vote.reviewer}-${index}`} className="gap-1">
                      <Text className="text-foreground text-[13px]">{vote.reviewer} · {vote.vote}</Text>
                      {vote.feedback ? <Text className="text-dimmed text-[11px]">{vote.feedback}</Text> : null}
                    </View>
                  ))}
                </GlassContainer>
              ) : null}
            </>
          ) : (
            <View className="items-center py-12 gap-3">
              <Icon name="clipboard" size={32} color={dimmed} />
              <Text className="text-dimmed text-sm text-center">No plan generated yet</Text>
              <Text className="text-dimmed text-xs text-center px-8">
                Generate a plan to let the team planner create and assign work.
              </Text>
            </View>
          )}
        </ScrollView>
      ) : null}

      <SheetModal visible={showTaskForm} onClose={() => setShowTaskForm(false)}>
        <ScrollView contentContainerStyle={{ gap: 16 }}>
          <Text className="text-foreground text-[17px] font-semibold">New Task</Text>

          <View className="gap-2">
            <Text className="text-dimmed text-xs">Subject</Text>
            <TextInput
              className="bg-muted rounded-2xl px-4 py-3 text-foreground"
              value={newSubject}
              onChangeText={setNewSubject}
              placeholder="Implement schedule retries"
              placeholderTextColor={mutedForeground}
            />
          </View>

          <View className="gap-2">
            <Text className="text-dimmed text-xs">Owner</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {team?.members.map((member) => (
                <Pressable
                  key={member.sessionId}
                  onPress={() => setNewOwner(member.name)}
                  className="px-3 py-2 rounded-full active:opacity-80 flex-row items-center gap-2"
                  style={{ backgroundColor: newOwner === member.name ? accent : "rgba(255,255,255,0.06)" }}
                >
                  {(member.tool === "claude" || member.tool === "codex") ? <ProviderIcon tool={member.tool} size={14} /> : null}
                  <Text style={{ color: newOwner === member.name ? primaryForeground : foreground }}>{member.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          <View className="gap-2">
            <Text className="text-dimmed text-xs">Description</Text>
            <TextInput
              className="bg-muted rounded-2xl px-4 py-3 text-foreground min-h-[120px]"
              value={newDescription}
              onChangeText={setNewDescription}
              placeholder="Describe what should be delivered"
              placeholderTextColor={mutedForeground}
              multiline
              textAlignVertical="top"
            />
          </View>

          <Pressable
            onPress={() => void handleAddTask()}
            disabled={addingTask || !newSubject.trim() || !newOwner.trim()}
            className="rounded-full py-4 items-center active:opacity-80"
            style={{ backgroundColor: addingTask || !newSubject.trim() || !newOwner.trim() ? "rgba(255,255,255,0.14)" : accent }}
          >
            <Text style={{ color: addingTask || !newSubject.trim() || !newOwner.trim() ? mutedForeground : primaryForeground }}>
              {addingTask ? "Creating..." : "Create Task"}
            </Text>
          </Pressable>
        </ScrollView>
      </SheetModal>

      <SheetModal visible={showPlanForm} onClose={() => setShowPlanForm(false)}>
        <ScrollView contentContainerStyle={{ gap: 16 }}>
          <Text className="text-foreground text-[17px] font-semibold">Generate Plan</Text>
          <View className="gap-2">
            <Text className="text-dimmed text-xs">Review Mode</Text>
            <View className="flex-row gap-2">
              {(["simple", "consensus"] as const).map((mode) => {
                const selected = planMode === mode;
                return (
                  <Pressable
                    key={mode}
                    onPress={() => setPlanMode(mode)}
                    className="px-3 py-2 rounded-full active:opacity-80"
                    style={{ backgroundColor: selected ? accent : "rgba(255,255,255,0.06)" }}
                  >
                    <Text style={{ color: selected ? primaryForeground : foreground, textTransform: "capitalize" }}>
                      {mode}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          {planMode === "consensus" ? (
            <View className="gap-2">
              <Text className="text-dimmed text-xs">Max Consensus Rounds</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {[2, 3, 4, 5, 6, 8, 10].map((value) => {
                  const selected = planMaxIterations === value;
                  return (
                    <Pressable
                      key={value}
                      onPress={() => setPlanMaxIterations(value)}
                      className="px-3 py-2 rounded-full active:opacity-80"
                      style={{ backgroundColor: selected ? accent : "rgba(255,255,255,0.06)" }}
                    >
                      <Text style={{ color: selected ? primaryForeground : foreground }}>{value}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
          <TextInput
            className="bg-muted rounded-2xl px-4 py-3 text-foreground min-h-[180px]"
            value={planRequest}
            onChangeText={setPlanRequest}
            placeholder="Describe what the team should plan and distribute autonomously"
            placeholderTextColor={mutedForeground}
            multiline
            textAlignVertical="top"
          />
          <Pressable
            onPress={() => void handleGeneratePlan()}
            disabled={generatingPlan || !planRequest.trim()}
            className="rounded-full py-4 items-center active:opacity-80"
            style={{ backgroundColor: generatingPlan || !planRequest.trim() ? "rgba(255,255,255,0.14)" : accent }}
          >
            <Text style={{ color: generatingPlan || !planRequest.trim() ? mutedForeground : primaryForeground }}>
              {generatingPlan ? "Generating..." : "Generate Plan"}
            </Text>
          </Pressable>
        </ScrollView>
      </SheetModal>

      <SheetModal visible={showTeamForm} onClose={() => setShowTeamForm(false)}>
        <ScrollView contentContainerStyle={{ gap: 16 }}>
          <Text className="text-foreground text-[17px] font-semibold">Edit Team</Text>

          <View className="gap-2">
            <Text className="text-dimmed text-xs">Team Name</Text>
            <TextInput
              className="bg-muted rounded-2xl px-4 py-3 text-foreground"
              value={editName}
              onChangeText={setEditName}
              placeholder="Team name"
              placeholderTextColor={mutedForeground}
            />
          </View>

          <View className="gap-2">
            <Text className="text-dimmed text-xs">Working Directory</Text>
            <TextInput
              className="bg-muted rounded-2xl px-4 py-3 text-foreground"
              value={editCwd}
              onChangeText={setEditCwd}
              placeholder="~/projects/openvide"
              placeholderTextColor={mutedForeground}
            />
          </View>

          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-dimmed text-xs">Members</Text>
              <Pressable
                onPress={() => setEditMembers((current) => [...current, { name: "", tool: "codex", role: "coder" }])}
                className="px-3 py-1.5 rounded-full active:opacity-80"
                style={{ backgroundColor: "rgba(255,255,255,0.06)" }}
              >
                <Text className="text-foreground text-xs">Add Member</Text>
              </Pressable>
            </View>

            {editMembers.map((member, index) => (
              <GlassContainer key={index} variant="card" className="p-3 gap-3">
                <TextInput
                  className="bg-muted rounded-2xl px-4 py-3 text-foreground"
                  value={member.name}
                  onChangeText={(value) => setEditMembers((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, name: value } : entry))}
                  placeholder="Agent name"
                  placeholderTextColor={mutedForeground}
                />

                <View className="gap-2">
                  <Text className="text-dimmed text-xs">Tool</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {TOOLS.map((tool) => {
                      const selected = member.tool === tool;
                      return (
                        <Pressable
                          key={tool}
                          onPress={() => setEditMembers((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, tool } : entry))}
                          className="px-3 py-2 rounded-full active:opacity-80 flex-row items-center gap-2"
                          style={{ backgroundColor: selected ? accent : "rgba(255,255,255,0.06)" }}
                        >
                          {(tool === "claude" || tool === "codex") ? <ProviderIcon tool={tool as "claude" | "codex"} size={14} /> : null}
                          <Text style={{ color: selected ? primaryForeground : foreground }}>{tool}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>

                <View className="gap-2">
                  <Text className="text-dimmed text-xs">Role</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {ROLES.map((role) => {
                      const selected = member.role === role;
                      return (
                        <Pressable
                          key={role}
                          onPress={() => setEditMembers((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, role } : entry))}
                          className="px-3 py-2 rounded-full active:opacity-80"
                          style={{ backgroundColor: selected ? accent : "rgba(255,255,255,0.06)" }}
                        >
                          <Text style={{ color: selected ? primaryForeground : foreground }}>{role}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>

                {editMembers.length > 1 ? (
                  <Pressable
                    onPress={() => setEditMembers((current) => current.filter((_, entryIndex) => entryIndex !== index))}
                    className="self-end px-3 py-1.5 rounded-full active:opacity-80"
                    style={{ backgroundColor: "rgba(255,80,80,0.14)" }}
                  >
                    <Text className="text-error-bright text-xs">Remove</Text>
                  </Pressable>
                ) : null}
              </GlassContainer>
            ))}
          </View>

          <Pressable
            onPress={() => void handleSaveTeam()}
            disabled={savingTeam || !editName.trim() || !editCwd.trim() || editMembers.some((member) => !member.name.trim())}
            className="rounded-full py-4 items-center active:opacity-80"
            style={{ backgroundColor: savingTeam || !editName.trim() || !editCwd.trim() || editMembers.some((member) => !member.name.trim()) ? "rgba(255,255,255,0.14)" : accent }}
          >
            <Text style={{ color: savingTeam || !editName.trim() || !editCwd.trim() || editMembers.some((member) => !member.name.trim()) ? mutedForeground : primaryForeground }}>
              {savingTeam ? "Saving..." : "Save Team"}
            </Text>
          </Pressable>
        </ScrollView>
      </SheetModal>
    </View>
  );
}
