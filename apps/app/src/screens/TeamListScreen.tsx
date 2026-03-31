import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppStore } from "../state/AppStoreContext";
import { GlassContainer } from "../components/GlassContainer";
import { Icon } from "../components/Icon";
import { ProviderIcon } from "../components/ProviderIcon";
import { SwipeableRow } from "../components/SwipeableRow";
import { SheetModal } from "../components/SheetModal";
import { useThemeColors } from "../constants/colors";
import type { TeamInfo, TeamMemberInput } from "../core/ai/Transport";
import type { MainStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<MainStackParamList, "TeamList">;

const TOOLS: Array<TeamMemberInput["tool"]> = ["claude", "codex"];
const ROLES: Array<TeamMemberInput["role"]> = ["lead", "planner", "coder", "reviewer"];

export function TeamListScreen({ navigation }: Props): JSX.Element {
  const { targets, getTeams, createTeam, deleteTeam } = useAppStore();
  const { dimmed, accent, foreground, mutedForeground, primaryForeground } = useThemeColors();
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [cwd, setCwd] = useState("");
  const [members, setMembers] = useState<TeamMemberInput[]>([
    { name: "", tool: "claude", role: "lead" },
  ]);

  useEffect(() => {
    if (!selectedTargetId && targets.length > 0) {
      setSelectedTargetId(targets[0]!.id);
    }
  }, [selectedTargetId, targets]);

  const refresh = useCallback(async () => {
    try {
      const result = await getTeams();
      setTeams(result);
    } catch {
      // Ignore refresh errors and keep the current list visible.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getTeams]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const resetForm = () => {
    setShowCreate(false);
    setCreating(false);
    setTeamName("");
    setCwd("");
    setMembers([{ name: "", tool: "claude", role: "lead" }]);
  };

  const handleCreate = useCallback(async () => {
    if (!selectedTargetId || !teamName.trim() || !cwd.trim() || members.some((member) => !member.name.trim())) {
      return;
    }
    setCreating(true);
    try {
      await createTeam({
        targetId: selectedTargetId,
        name: teamName.trim(),
        cwd: cwd.trim(),
        members: members.map((member) => ({
          ...member,
          name: member.name.trim(),
        })),
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      resetForm();
      await refresh();
    } catch {
      setCreating(false);
    }
  }, [createTeam, cwd, members, refresh, selectedTargetId, teamName]);

  const handleDelete = useCallback(async (teamId: string) => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await deleteTeam(teamId);
      refresh();
    } catch {
      // Ignore delete failures so the row stays visible.
    }
  }, [deleteTeam, refresh]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    refresh();
  }, [refresh]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => setShowCreate(true)}
          className="w-10 h-10 items-center justify-center active:opacity-80"
        >
          <Icon name="plus" size={18} color={accent} />
        </Pressable>
      ),
    });
  }, [navigation, accent]);

  const canCreate = !!selectedTargetId && teamName.trim().length > 0 && cwd.trim().length > 0 && members.every((member) => member.name.trim().length > 0);

  const selectedTarget = useMemo(() => targets.find((target) => target.id === selectedTargetId), [selectedTargetId, targets]);

  if (loading) {
    return (
      <View className="flex-1 bg-background justify-center items-center">
        <ActivityIndicator size="small" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={teams}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
        renderItem={({ item }) => (
          <SwipeableRow
            onPress={() => navigation.navigate("TeamDetail", { teamId: item.id })}
            onDelete={() => handleDelete(item.id)}
            confirmTitle="Delete Team"
            confirmMessage={`Delete "${item.name}"?`}
          >
            <GlassContainer variant="card" className="p-4 gap-2.5">
              <View className="flex-row items-center justify-between">
                <Text className="text-foreground text-[15px] font-semibold flex-1" numberOfLines={1}>
                  {item.name}
                </Text>
                <Text className="text-dimmed text-xs">
                  {item.members.length} member{item.members.length !== 1 ? "s" : ""}
                </Text>
              </View>

              {item.targetLabel ? (
                <View className="flex-row items-center gap-1">
                  <Icon name="server" size={12} color={dimmed} />
                  <Text className="text-dimmed text-xs" numberOfLines={1}>{item.targetLabel}</Text>
                </View>
              ) : null}

              {item.workingDirectory ? (
                <View className="flex-row items-center gap-1">
                  <Icon name="folder" size={12} color={dimmed} />
                  <Text className="text-dimmed text-xs" numberOfLines={1}>{item.workingDirectory}</Text>
                </View>
              ) : null}

              {item.members.length > 0 ? (
                <View className="flex-row flex-wrap items-center gap-2 mt-1">
                  {item.members.map((member, idx) => (
                    <View key={idx} className="flex-row items-center gap-1.5 bg-muted rounded-full px-2 py-1">
                      {(member.tool === "claude" || member.tool === "codex") ? (
                        <ProviderIcon tool={member.tool} size={12} />
                      ) : null}
                      <Text className="text-dimmed text-[11px]">{member.name}</Text>
                      <Text className="text-dimmed text-[10px] opacity-60">{member.role}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </GlassContainer>
          </SwipeableRow>
        )}
        ListEmptyComponent={
          <View className="items-center py-12 gap-3">
            <Icon name="users" size={32} color={dimmed} />
            <Text className="text-dimmed text-sm text-center">
              No teams yet
            </Text>
            <Text className="text-dimmed text-xs text-center px-8">
              Create a team with planner, coder, and reviewer roles.
            </Text>
          </View>
        }
      />

      <SheetModal visible={showCreate} onClose={resetForm}>
        <ScrollView contentContainerStyle={{ gap: 16 }}>
          <Text className="text-foreground text-[17px] font-semibold">New Team</Text>

          <View className="gap-2">
            <Text className="text-dimmed text-xs">Host</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {targets.map((target) => {
                const selected = target.id === selectedTargetId;
                return (
                  <Pressable
                    key={target.id}
                    onPress={() => setSelectedTargetId(target.id)}
                    className="px-3 py-2 rounded-full active:opacity-80"
                    style={{ backgroundColor: selected ? accent : "rgba(255,255,255,0.06)" }}
                  >
                    <Text style={{ color: selected ? primaryForeground : foreground }}>{target.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {selectedTarget ? (
            <Text className="text-dimmed text-xs">Creating on {selectedTarget.label}</Text>
          ) : null}

          <View className="gap-2">
            <Text className="text-dimmed text-xs">Team Name</Text>
            <TextInput
              className="bg-muted rounded-2xl px-4 py-3 text-foreground"
              value={teamName}
              onChangeText={setTeamName}
              placeholder="open-vide-g2"
              placeholderTextColor={mutedForeground}
            />
          </View>

          <View className="gap-2">
            <Text className="text-dimmed text-xs">Working Directory</Text>
            <TextInput
              className="bg-muted rounded-2xl px-4 py-3 text-foreground"
              value={cwd}
              onChangeText={setCwd}
              placeholder="~/projects/openvide"
              placeholderTextColor={mutedForeground}
            />
          </View>

          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-dimmed text-xs">Members</Text>
              <Pressable
                onPress={() => setMembers((current) => [...current, { name: "", tool: "claude", role: "coder" }])}
                className="px-3 py-1.5 rounded-full active:opacity-80"
                style={{ backgroundColor: "rgba(255,255,255,0.06)" }}
              >
                <Text className="text-foreground text-xs">Add Member</Text>
              </Pressable>
            </View>

            {members.map((member, index) => (
              <GlassContainer key={index} variant="card" className="p-3 gap-3">
                <TextInput
                  className="bg-muted rounded-2xl px-4 py-3 text-foreground"
                  value={member.name}
                  onChangeText={(value) => setMembers((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, name: value } : entry))}
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
                          onPress={() => setMembers((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, tool } : entry))}
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
                          onPress={() => setMembers((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, role } : entry))}
                          className="px-3 py-2 rounded-full active:opacity-80"
                          style={{ backgroundColor: selected ? accent : "rgba(255,255,255,0.06)" }}
                        >
                          <Text style={{ color: selected ? primaryForeground : foreground }}>{role}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>

                {members.length > 1 ? (
                  <Pressable
                    onPress={() => setMembers((current) => current.filter((_, entryIndex) => entryIndex !== index))}
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
            onPress={handleCreate}
            disabled={!canCreate || creating}
            className="rounded-full py-4 items-center active:opacity-80"
            style={{ backgroundColor: canCreate && !creating ? accent : "rgba(255,255,255,0.14)" }}
          >
            <Text style={{ color: canCreate && !creating ? primaryForeground : mutedForeground }}>
              {creating ? "Creating..." : "Create Team"}
            </Text>
          </Pressable>
        </ScrollView>
      </SheetModal>
    </View>
  );
}
