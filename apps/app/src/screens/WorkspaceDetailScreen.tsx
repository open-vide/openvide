import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppStore } from "../state/AppStoreContext";
import type { MainStackParamList } from "../navigation/types";
import { Icon } from "../components/Icon";
import { GlassContainer } from "../components/GlassContainer";
import { ProviderIcon } from "../components/ProviderIcon";
import { SwipeableRow } from "../components/SwipeableRow";
import { useThemeColors } from "../constants/colors";
import { formatRelativeTime } from "../core/formatTime";
import { cn } from "../lib/utils";
import type { AiSession } from "../core/types";
import type { WorkspaceChatInfo } from "../core/ai/DaemonTransport";

type Props = NativeStackScreenProps<MainStackParamList, "WorkspaceDetail">;
type WorkspaceRow =
  | { id: string; kind: "workspace-chat"; chat: WorkspaceChatInfo }
  | { id: string; kind: "local-session"; session: AiSession };

const WORKSPACE_CHAT_CACHE = new Map<string, WorkspaceChatInfo[]>();

function sessionTitle(session: AiSession): string {
  const lastUserMsg = [...session.messages].reverse().find((m) => m.role === "user");
  if (lastUserMsg) {
    const text = lastUserMsg.content.find((b) => b.type === "text")?.text ?? "";
    if (text.trim()) return text.trim().slice(0, 72);
  }
  if (session.conversationId) return session.conversationId;
  return session.id;
}

function workspaceChatTitle(chat: WorkspaceChatInfo): string {
  const title = chat.title?.trim();
  if (title) return title;
  const summary = chat.summary?.trim();
  if (summary) return summary;
  return chat.resumeId;
}

function toWorkspaceSyncErrorMessage(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).trim();
  if (!message) {
    return "Unable to refresh chats right now. Showing last synced chats.";
  }
  return `Unable to refresh chats right now. Showing last synced chats. (${message})`;
}

function workspaceChatCacheKey(chat: WorkspaceChatInfo): string {
  return [
    chat.id,
    chat.origin,
    chat.tool,
    chat.status,
    chat.resumeId,
    chat.daemonSessionId ?? "",
    chat.updatedAt ?? "",
    chat.title ?? "",
    chat.summary ?? "",
    String(chat.messageCount ?? ""),
  ].join("|");
}

function sameWorkspaceChats(a: WorkspaceChatInfo[], b: WorkspaceChatInfo[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return false;
    if (workspaceChatCacheKey(left) !== workspaceChatCacheKey(right)) return false;
  }
  return true;
}

export function WorkspaceDetailScreen({ route, navigation }: Props): JSX.Element {
  const { workspaceId } = route.params;
  const {
    getWorkspace,
    getTarget,
    listWorkspaceChats,
    openWorkspaceChat,
    sessions: allSessions,
    deleteSession,
  } = useAppStore();
  const { accent } = useThemeColors();
  const [workspaceChats, setWorkspaceChats] = useState<WorkspaceChatInfo[]>(
    () => WORKSPACE_CHAT_CACHE.get(workspaceId) ?? [],
  );
  const [refreshing, setRefreshing] = useState(false);
  const [loadingChats, setLoadingChats] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openingChatId, setOpeningChatId] = useState<string | null>(null);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);

  const workspace = getWorkspace(workspaceId);
  const target = workspace ? getTarget(workspace.targetId) : undefined;

  useEffect(() => {
    setWorkspaceChats(WORKSPACE_CHAT_CACHE.get(workspaceId) ?? []);
  }, [workspaceId]);

  const refreshWorkspaceChats = useCallback(async (showSpinner: boolean) => {
    if (!workspace) return;
    const inFlight = refreshInFlightRef.current;
    if (inFlight) {
      await inFlight;
      return;
    }

    setLoadError(null);
    if (showSpinner) {
      setLoadingChats(true);
    }

    const startedAt = Date.now();
    const task = (async () => {
      try {
        const chats = await listWorkspaceChats(workspace.id);
        WORKSPACE_CHAT_CACHE.set(workspace.id, chats);
        setWorkspaceChats((current) => (sameWorkspaceChats(current, chats) ? current : chats));
      } catch (err) {
        setLoadError(toWorkspaceSyncErrorMessage(err));
      } finally {
        if (showSpinner) {
          setLoadingChats(false);
        }
        console.log("[OV:workspace] refresh chats elapsed=", Date.now() - startedAt, "ms");
      }
    })();

    refreshInFlightRef.current = task;
    try {
      await task;
    } finally {
      if (refreshInFlightRef.current === task) {
        refreshInFlightRef.current = null;
      }
    }
  }, [listWorkspaceChats, workspace]);

  useEffect(() => {
    void refreshWorkspaceChats(true);
  }, [refreshWorkspaceChats]);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      void refreshWorkspaceChats(false);
    });
    return unsubscribe;
  }, [navigation, refreshWorkspaceChats]);

  const localSessions = useMemo(() => {
    return allSessions
      .filter((s) => s.workspaceId === workspaceId)
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }, [allSessions, workspaceId]);

  const rows = useMemo(() => {
    const out: WorkspaceRow[] = [];
    const seen = new Set<string>();
    for (const chat of workspaceChats) {
      const dedupKey = chat.daemonSessionId
        ? `daemon:${chat.daemonSessionId}`
        : `${chat.tool}:resume:${chat.resumeId}`;
      seen.add(dedupKey);
      out.push({ id: `workspace-chat:${chat.id}`, kind: "workspace-chat", chat });
    }

    for (const session of localSessions) {
      const dedupKey = session.daemonSessionId
        ? `daemon:${session.daemonSessionId}`
        : ((session.tool === "claude" || session.tool === "codex") && session.conversationId)
          ? `${session.tool}:resume:${session.conversationId}`
          : undefined;
      if (dedupKey && seen.has(dedupKey)) continue;
      out.push({ id: `local-session:${session.id}`, kind: "local-session", session });
    }

    return out.sort((a, b) => {
      const aUpdated = a.kind === "workspace-chat" ? (a.chat.updatedAt ?? "") : (a.session.updatedAt ?? "");
      const bUpdated = b.kind === "workspace-chat" ? (b.chat.updatedAt ?? "") : (b.session.updatedAt ?? "");
      return bUpdated.localeCompare(aUpdated);
    });
  }, [localSessions, workspaceChats]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: workspace?.name ?? "Workspace",
      headerRight: () => (
        <Pressable
          onPress={() => navigation.getParent()?.navigate("NewWorkspaceChatSheet", { workspaceId })}
          className="w-10 h-10 items-center justify-center active:opacity-80"
          hitSlop={8}
        >
          <Icon name="plus" size={20} color={accent} />
        </Pressable>
      ),
    });
  }, [navigation, workspace?.name, workspaceId, accent]);

  const subtitle = useMemo(() => {
    if (!workspace) return "";
    const hostLabel = target?.label ?? "Unknown host";
    return `${hostLabel} · ${workspace.directory}`;
  }, [workspace, target?.label]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshWorkspaceChats(false);
    } finally {
      setRefreshing(false);
    }
  }, [refreshWorkspaceChats]);

  const handleDeleteWorkspaceChat = useCallback((chat: WorkspaceChatInfo) => {
    // Find matching local session by daemonSessionId or conversationId
    const match = allSessions.find((s) =>
      (chat.daemonSessionId && s.daemonSessionId === chat.daemonSessionId) ||
      (chat.resumeId && s.conversationId === chat.resumeId),
    );
    if (match) {
      void deleteSession(match.id);
    }
    // Remove from local workspace chats state + cache
    setWorkspaceChats((prev) => {
      const next = prev.filter((c) => c.id !== chat.id);
      WORKSPACE_CHAT_CACHE.set(workspaceId, next);
      return next;
    });
  }, [allSessions, deleteSession, workspaceId]);

  const handleOpenWorkspaceChat = useCallback(async (chat: WorkspaceChatInfo) => {
    if (!workspace) return;
    setOpeningChatId(chat.id);
    try {
      const session = await openWorkspaceChat(workspace.id, chat.id);
      navigation.navigate("AiChat", { sessionId: session.id, workspaceId: workspace.id });
    } finally {
      setOpeningChatId((current) => (current === chat.id ? null : current));
    }
  }, [navigation, openWorkspaceChat, workspace]);

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
      {loadError && (
        <View className="px-4 pt-2">
          <Text className="text-warning text-xs">{loadError}</Text>
        </View>
      )}

      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 12, paddingTop: 8 }}
        onRefresh={() => void handleRefresh()}
        refreshing={refreshing}
        renderItem={({ item }) => {
          if (item.kind === "workspace-chat") {
            const chat = item.chat;
            const isOpening = openingChatId === chat.id;
            return (
              <SwipeableRow
                onPress={() => void handleOpenWorkspaceChat(chat)}
                disabled={isOpening}
                onDelete={() => handleDeleteWorkspaceChat(chat)}
                confirmTitle="Delete Chat"
                confirmMessage={`Delete this ${chat.tool} chat? This cannot be undone.`}
              >
                <GlassContainer variant="card" className="p-3.5 gap-2.5">
                  <View className="flex-row justify-between items-center">
                    <View className="flex-row items-center gap-2">
                      <ProviderIcon tool={chat.tool} size={20} />
                      <Text className="text-foreground text-sm font-semibold capitalize">{chat.tool}</Text>
                    </View>
                    <Text className="text-muted-foreground text-xs">
                      {chat.updatedAt ? formatRelativeTime(chat.updatedAt) : "unknown"}
                    </Text>
                  </View>
                  <Text className="text-foreground text-sm" numberOfLines={2}>
                    {workspaceChatTitle(chat)}
                  </Text>
                  <View className="flex-row items-center justify-between">
                    <Text className="text-dimmed text-xs">
                      {typeof chat.messageCount === "number" ? `${chat.messageCount} messages` : "Open to load history"}
                    </Text>
                    {isOpening ? (
                      <ActivityIndicator size="small" color={accent} />
                    ) : (
                      <Text
                        className={cn(
                          "text-xs font-semibold capitalize",
                          chat.status === "idle" && "text-dimmed",
                          chat.status === "running" && "text-accent",
                          chat.status === "failed" && "text-destructive",
                          (chat.status === "cancelled" || chat.status === "awaiting_input") && "text-warning",
                        )}
                      >
                        {chat.status}
                      </Text>
                    )}
                  </View>
                </GlassContainer>
              </SwipeableRow>
            );
          }

          const session = item.session;
          return (
            <SwipeableRow
              onPress={() => navigation.navigate("AiChat", { sessionId: session.id, workspaceId: workspace.id })}
              onDelete={() => deleteSession(session.id)}
              confirmTitle="Delete Session"
              confirmMessage={`Delete this ${session.tool} session? This cannot be undone.`}
            >
              <GlassContainer variant="card" className="p-3.5 gap-2.5">
                <View className="flex-row justify-between items-center">
                  <View className="flex-row items-center gap-2">
                    <ProviderIcon tool={session.tool as "claude" | "codex"} size={20} />
                    <Text className="text-foreground text-sm font-semibold capitalize">{session.tool}</Text>
                  </View>
                  <Text className="text-muted-foreground text-xs">
                    {session.updatedAt ? formatRelativeTime(session.updatedAt) : "unknown"}
                  </Text>
                </View>
                <Text className="text-foreground text-sm" numberOfLines={2}>
                  {sessionTitle(session)}
                </Text>
                <View className="flex-row items-center justify-between">
                  <Text className="text-dimmed text-xs">
                    {session.messages.length} messages
                  </Text>
                  <Text
                    className={cn(
                      "text-xs font-semibold capitalize",
                      session.status === "idle" && "text-dimmed",
                      session.status === "running" && "text-accent",
                      session.status === "failed" && "text-destructive",
                      (session.status === "cancelled" || session.status === "awaiting_input") && "text-warning",
                    )}
                  >
                    {session.status}
                  </Text>
                </View>
              </GlassContainer>
            </SwipeableRow>
          );
        }}
        ListEmptyComponent={
          <View className="items-center py-8">
            {loadingChats ? (
              <ActivityIndicator size="small" color={accent} />
            ) : (
              <Text className="text-dimmed text-sm text-center">
                No sessions yet. Tap + to start a chat.
              </Text>
            )}
          </View>
        }
      />
    </View>
  );
}
