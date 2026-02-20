import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ProviderIcon } from "../components/ProviderIcon";
import { Icon } from "../components/Icon";
import { colors } from "../constants/colors";
import { getDefaultModel } from "../core/modelOptions";
import type { ToolName } from "../core/types";
import { cn } from "../lib/utils";
import type { RootStackParamList } from "../navigation/types";
import { useAppStore } from "../state/AppStoreContext";

type Props = NativeStackScreenProps<RootStackParamList, "NewWorkspaceChatSheet">;

const TOOL_LABELS: Record<ToolName, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini",
};

export function NewWorkspaceChatSheet({ route, navigation }: Props): JSX.Element {
  const { workspaceId } = route.params ?? {};
  const { getWorkspace, getTarget, createDraftSession } = useAppStore();

  const workspace = workspaceId ? getWorkspace(workspaceId) : undefined;
  const target = workspace ? getTarget(workspace.targetId) : undefined;

  const availableTools = useMemo(() => {
    if (!target?.detectedTools) return [] as ToolName[];
    const result: ToolName[] = [];
    if (target.detectedTools.claude?.installed) result.push("claude");
    if (target.detectedTools.codex?.installed) result.push("codex");
    return result;
  }, [target]);

  const [selectedTool, setSelectedTool] = useState<ToolName | null>(availableTools[0] ?? null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = workspace != null && target != null && selectedTool != null && availableTools.length > 0 && !creating;

  const handleCreate = async (): Promise<void> => {
    if (!workspace || !target || !selectedTool) return;
    setCreating(true);
    setError(null);
    try {
      const session = await createDraftSession({
        targetId: workspace.targetId,
        workspaceId: workspace.id,
        tool: selectedTool,
        workingDirectory: workspace.directory,
        model: getDefaultModel(selectedTool),
      });
      navigation.goBack();
      navigation.navigate("Main", { screen: "AiChat", params: { sessionId: session.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  if (!workspace || !target) {
    return (
      <View className="flex-1 bg-card items-center justify-center p-6">
        <Text className="text-dimmed text-sm text-center">Workspace not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-card" contentContainerStyle={{ padding: 20, gap: 14 }}>
      <View className="bg-muted rounded-2xl p-4">
        <Text className="text-foreground text-base font-semibold">{workspace.name}</Text>
        <Text className="text-dimmed text-xs mt-1">{target.label} · {workspace.directory}</Text>
      </View>

      <Text className="text-foreground text-[15px] font-bold uppercase mt-2">CLI</Text>
      {availableTools.length === 0 ? (
        <View className="flex-row items-center gap-2 bg-muted rounded-2xl p-3">
          <Icon name="alert-triangle" size={16} color={colors.warning} />
          <Text className="text-warning text-[13px] flex-1">
            No Claude/Codex CLI detected on this host.
          </Text>
        </View>
      ) : (
        <View className="flex-row gap-3">
          {availableTools.map((tool) => (
            <Pressable
              key={tool}
              className={cn(
                "flex-1 flex-row items-center gap-2.5 px-4 py-4 bg-muted rounded-2xl border-2",
                selectedTool === tool ? "border-accent" : "border-transparent",
              )}
              onPress={() => setSelectedTool(tool)}
            >
              <ProviderIcon tool={tool as "claude" | "codex"} size={24} />
              <Text
                className={cn(
                  "text-[15px] font-semibold",
                  selectedTool === tool ? "text-accent" : "text-foreground",
                )}
              >
                {TOOL_LABELS[tool]}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {error && <Text className="text-error-bright text-[13px]">{error}</Text>}

      <Pressable
        className={cn("bg-accent rounded-full py-4 items-center mt-3 flex-row justify-center gap-2", !canCreate && "opacity-40")}
        onPress={() => void handleCreate()}
        disabled={!canCreate}
      >
        {creating && <ActivityIndicator size="small" color="#ffffff" />}
        <Text className="text-white font-bold text-base">{creating ? "Creating..." : "Create Chat"}</Text>
      </Pressable>
    </ScrollView>
  );
}
