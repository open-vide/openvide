import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { WorkspaceChatInfo } from "../core/ai/DaemonTransport";
import { useAppStore } from "../state/AppStoreContext";
import type { MainStackParamList } from "../navigation/types";
import { Icon } from "../components/Icon";
import { GlassContainer } from "../components/GlassContainer";
import { ProviderIcon } from "../components/ProviderIcon";
import { colors } from "../constants/colors";
import { formatRelativeTime } from "../core/formatTime";
import { cn } from "../lib/utils";

type Props = NativeStackScreenProps<MainStackParamList, "WorkspaceDetail">;

function sessionTitle(session: WorkspaceChatInfo): string {
  if (session.title?.trim()) return session.title.trim().slice(0, 72);
  const prompt = session.lastTurn?.prompt?.trim();
  if (prompt && prompt.length > 0) return prompt.slice(0, 72);
  if (session.summary?.trim()) return session.summary.trim().slice(0, 72);
  if (session.conversationId) return session.conversationId;
  if (session.resumeId) return session.resumeId;
  return session.id;
}

export function WorkspaceDetailScreen({ route, navigation }: Props): JSX.Element {
  const { workspaceId } = route.params;
  const {
    getWorkspace,
    getTarget,
    listWorkspaceChats,
    openWorkspaceChat,
  } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<WorkspaceChatInfo[]>([]);

  const workspace = getWorkspace(workspaceId);
  const target = workspace ? getTarget(workspace.targetId) : undefined;

  const load = useCallback(async (isRefresh = false) => {
    if (!workspace) return;
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const items = await listWorkspaceChats(workspace.id);
      setSessions(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSessions([]);
    } finally {
      if (isRefresh) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, [workspace, listWorkspaceChats]);

  useEffect(() => {
    void load();
  }, [load]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: workspace?.name ?? "Workspace",
      headerRight: () => (
        <Pressable
          onPress={() => navigation.getParent()?.navigate("NewWorkspaceChatSheet", { workspaceId })}
          className="w-10 h-10 items-center justify-center active:opacity-80"
        >
          <Icon name="plus" size={24} color={colors.accent} />
        </Pressable>
      ),
    });
  }, [navigation, workspace?.name, workspaceId]);

  const handleOpen = useCallback(async (workspaceChatId: string) => {
    if (!workspace) return;
    setOpeningId(workspaceChatId);
    try {
      const localSession = await openWorkspaceChat(workspace.id, workspaceChatId);
      navigation.navigate("AiChat", { sessionId: localSession.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpeningId(null);
    }
  }, [workspace, openWorkspaceChat, navigation]);

  const subtitle = useMemo(() => {
    if (!workspace) return "";
    const hostLabel = target?.label ?? "Unknown host";
    return `${hostLabel} · ${workspace.directory}`;
  }, [workspace, target?.label]);

  if (!workspace) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <Text className="text-dimmed text-sm">Workspace not found</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <View className="px-4 pt-3 pb-2 border-b border-border">
        <Text className="text-dimmed text-xs" numberOfLines={1}>{subtitle}</Text>
      </View>

      {error && (
        <View className="px-4 py-3">
          <Text className="text-warning text-sm">{error}</Text>
        </View>
      )}

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 12, paddingTop: 8 }}
          onRefresh={() => void load(true)}
          refreshing={refreshing}
          renderItem={({ item }) => (
            <Pressable className="active:opacity-80" onPress={() => void handleOpen(item.id)}>
              <GlassContainer variant="card" className="p-3.5 gap-2.5">
                <View className="flex-row justify-between items-center">
                  <View className="flex-row items-center gap-2">
                    <ProviderIcon tool={item.tool} size={20} />
                    <Text className="text-foreground text-sm font-semibold capitalize">{item.tool}</Text>
                    <View className="px-1.5 py-0.5 rounded bg-muted">
                      <Text className="text-[10px] text-dimmed uppercase">{item.origin}</Text>
                    </View>
                  </View>
                  <Text className="text-muted-foreground text-xs">
                    {item.updatedAt ? formatRelativeTime(item.updatedAt) : "unknown"}
                  </Text>
                </View>
                <Text className="text-foreground text-sm" numberOfLines={2}>
                  {sessionTitle(item)}
                </Text>
                <View className="flex-row items-center justify-between">
                  <Text className="text-dimmed text-xs" numberOfLines={1}>
                    {item.resumeId}
                  </Text>
                  <Text
                    className={cn(
                      "text-xs font-semibold capitalize",
                      item.status === "idle" && "text-dimmed",
                      item.status === "running" && "text-accent",
                      item.status === "failed" && "text-destructive",
                      (item.status === "cancelled" || item.status === "interrupted") && "text-warning",
                    )}
                  >
                    {openingId === item.id ? "opening..." : item.status}
                  </Text>
                </View>
              </GlassContainer>
            </Pressable>
          )}
          ListEmptyComponent={
            <View className="items-center py-8">
              <Text className="text-dimmed text-sm text-center">
                No Claude/Codex chats found for this directory (native or daemon).
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}
