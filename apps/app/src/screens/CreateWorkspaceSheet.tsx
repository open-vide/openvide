import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CommonActions } from "@react-navigation/native";
import { HostStatusDot } from "../components/HostStatusDot";
import { Icon } from "../components/Icon";
import { useThemeColors } from "../constants/colors";
import type { RootStackParamList } from "../navigation/types";
import { useAppStore } from "../state/AppStoreContext";
import { cn } from "../lib/utils";

type Props = NativeStackScreenProps<RootStackParamList, "CreateWorkspaceSheet">;

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function CreateWorkspaceSheet({ route, navigation }: Props): JSX.Element {
  const {
    targets,
    createWorkspace,
    getWorkspaceHostEligibility,
  } = useAppStore();
  const { dimmed, accent, warning } = useThemeColors();

  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(route.params?.selectedTargetId ?? null);
  const [directory, setDirectory] = useState("");
  const [name, setName] = useState(route.params?.nameValue ?? "");
  const [nameEdited, setNameEdited] = useState(route.params?.nameEdited ?? false);
  const [hostDropdownOpen, setHostDropdownOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligibleTargets = useMemo(
    () => targets.filter((target) => getWorkspaceHostEligibility(target.id).eligible),
    [targets, getWorkspaceHostEligibility],
  );

  useEffect(() => {
    if (selectedTargetId != null) return;
    if (eligibleTargets.length > 0) {
      setSelectedTargetId(eligibleTargets[0]!.id);
      return;
    }
    if (targets.length > 0) {
      setSelectedTargetId(targets[0]!.id);
    }
  }, [targets, eligibleTargets, selectedTargetId]);

  useEffect(() => {
    const selectedDirectory = route.params?.selectedDirectory?.trim();
    if (!selectedDirectory) return;
    setDirectory(selectedDirectory);
    if (!nameEdited) {
      setName(basename(selectedDirectory));
    }
  }, [route.params?.selectedDirectory, nameEdited]);

  const selectedTarget = useMemo(
    () => targets.find((target) => target.id === selectedTargetId),
    [targets, selectedTargetId],
  );

  const selectedEligibility = useMemo(
    () => (selectedTargetId ? getWorkspaceHostEligibility(selectedTargetId) : { eligible: false, reason: "Select a host." }),
    [selectedTargetId, getWorkspaceHostEligibility],
  );

  const canCreate = selectedTargetId != null && selectedEligibility.eligible && directory.trim().length > 0 && !creating;

  const handleCreate = async (): Promise<void> => {
    if (!canCreate || !selectedTargetId) return;
    setCreating(true);
    setError(null);
    try {
      const workspace = await createWorkspace({
        targetId: selectedTargetId,
        directory: directory.trim(),
        name: name.trim() || undefined,
      });
      navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [
            {
              name: "Main",
              state: {
                routes: [
                  { name: "WorkspaceList" },
                  { name: "WorkspaceDetail", params: { workspaceId: workspace.id } },
                ],
                index: 1,
              },
            },
          ],
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-card" contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets showsVerticalScrollIndicator={false}>
      <Text className="text-foreground text-[15px] font-bold uppercase mt-2">Host</Text>
      {targets.length === 0 && (
        <Text className="text-dimmed text-[13px]">No hosts added yet. Add a host first.</Text>
      )}
      {targets.length > 0 && (
        <>
          <Pressable
            className="flex-row items-center gap-3 p-3 bg-muted rounded-2xl border-2 border-accent"
            onPress={() => setHostDropdownOpen((value) => !value)}
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
            <Icon name={hostDropdownOpen ? "chevron-up" : "chevron-down"} size={18} color={dimmed} />
          </Pressable>

          {hostDropdownOpen && (
            <View className="bg-muted rounded-2xl overflow-hidden">
              {targets.map((target) => {
                const eligible = getWorkspaceHostEligibility(target.id);
                return (
                  <Pressable
                    key={target.id}
                    className={cn(
                      "flex-row items-center gap-3 p-3 active:opacity-80",
                      selectedTargetId === target.id && "bg-card",
                    )}
                    onPress={() => {
                      setSelectedTargetId(target.id);
                      setHostDropdownOpen(false);
                    }}
                  >
                    <HostStatusDot status={target.lastStatus} />
                    <View className="flex-1">
                      <Text className="text-foreground font-semibold text-[15px]">{target.label}</Text>
                      <Text className="text-muted-foreground text-[13px]">
                        {target.username}@{target.host}:{target.port}
                      </Text>
                      {!eligible.eligible && (
                        <Text className="text-warning text-[12px]">{eligible.reason}</Text>
                      )}
                    </View>
                    {selectedTargetId === target.id && (
                      <Icon name="check" size={18} color={accent} />
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}
        </>
      )}

      {targets.length > 0 && !selectedEligibility.eligible && (
        <View className="flex-row items-center gap-2 bg-muted rounded-2xl p-3">
          <Icon name="alert-triangle" size={16} color={warning} />
          <Text className="text-warning text-[13px] flex-1">
            {selectedEligibility.reason}
          </Text>
        </View>
      )}

      {targets.length > 0 && eligibleTargets.length === 0 && (
        <Text className="text-warning text-[13px]">
          No eligible host found. Install and detect daemon + Claude/Codex on a host first.
        </Text>
      )}

      <Text className="text-foreground text-[15px] font-bold uppercase mt-2">Directory</Text>
      <View className="flex-row items-center gap-2">
        <TextInput
          className="flex-1 bg-muted rounded-2xl p-4 text-foreground text-[16px]"
          value={directory}
          onChangeText={(value) => {
            setDirectory(value);
            if (!nameEdited && value.trim().length > 0) {
              setName(basename(value.trim()));
            }
          }}
          placeholder="/home/user/project"
          placeholderTextColor={dimmed}
        />
        <Pressable
          className={cn(
            "w-12 h-12 rounded-2xl bg-muted items-center justify-center active:opacity-80",
            !selectedTargetId && "opacity-40",
          )}
          onPress={() => {
            if (!selectedTargetId) return;
            navigation.navigate("DirectoryPicker", {
              targetId: selectedTargetId,
              currentPath: directory.trim() || undefined,
              returnTo: "CreateWorkspaceSheet",
              returnState: {
                selectedTargetId,
                nameValue: name,
                nameEdited,
              },
            });
          }}
          disabled={!selectedTargetId}
        >
          <Icon name="folder" size={20} color={accent} />
        </Pressable>
      </View>

      <Text className="text-foreground text-[15px] font-bold uppercase mt-2">Name</Text>
      <TextInput
        className="bg-muted rounded-2xl p-4 text-foreground text-[16px]"
        value={name}
        onChangeText={(value) => {
          setNameEdited(true);
          setName(value);
        }}
        placeholder="Workspace name"
        placeholderTextColor={dimmed}
      />

      {error && <Text className="text-error-bright text-[13px]">{error}</Text>}

      <Pressable
        className={cn("bg-accent rounded-full py-4 items-center mt-3 flex-row justify-center gap-2", !canCreate && "opacity-40")}
        onPress={() => void handleCreate()}
        disabled={!canCreate}
      >
        {creating && <ActivityIndicator size="small" color="#ffffff" />}
        <Text className="text-white font-bold text-base">{creating ? "Creating..." : "Create Workspace"}</Text>
      </Pressable>
    </ScrollView>
  );
}
