import React, { useCallback, useLayoutEffect, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppStore } from "../state/AppStoreContext";
import { SwipeableRow } from "../components/SwipeableRow";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { GlassContainer } from "../components/GlassContainer";
import { useThemeColors } from "../constants/colors";
import { formatRelativeTime } from "../core/formatTime";
import type { MainStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<MainStackParamList, "WorkspaceList">;

export function WorkspaceListScreen({ navigation }: Props): JSX.Element {
  const { workspaces, targets, deleteWorkspace } = useAppStore();
  const [refreshing, setRefreshing] = useState(false);
  const { accent } = useThemeColors();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => navigation.getParent()?.navigate("CreateWorkspaceSheet" as never)}
          className="w-10 h-10 items-center justify-center active:opacity-80"
        >
          <Icon name="plus" size={24} color={accent} />
        </Pressable>
      ),
    });
  }, [accent, navigation]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 500);
  }, []);

  const getHostLabel = (targetId: string): string => {
    const target = targets.find((t) => t.id === targetId);
    return target?.label ?? "Unknown host";
  };

  if (workspaces.length === 0) {
    return (
      <View className="flex-1 bg-background">
        <EmptyState
          icon="folder"
          message="Create your first workspace"
          actionLabel="New Workspace"
          onAction={() => navigation.getParent()?.navigate("CreateWorkspaceSheet" as never)}
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={workspaces}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        windowSize={10}
        maxToRenderPerBatch={8}
        removeClippedSubviews
        renderItem={({ item }) => (
          <SwipeableRow
            onDelete={() => void deleteWorkspace(item.id)}
            confirmTitle="Delete Workspace"
            confirmMessage={`Delete workspace "${item.name}"? Linked local chats will be removed.`}
            actionLabel="Delete"
          >
            <Pressable
              className="active:opacity-80"
              onPress={() => navigation.navigate("WorkspaceDetail", { workspaceId: item.id })}
            >
              <GlassContainer variant="card" className="p-3.5 gap-2.5">
                <View className="flex-row justify-between items-center">
                  <View className="flex-row items-center gap-2">
                    <Icon name="folder" size={18} color={accent} />
                    <Text className="text-foreground font-semibold text-sm">{item.name}</Text>
                  </View>
                  <Text className="text-muted-foreground text-xs">{formatRelativeTime(item.updatedAt)}</Text>
                </View>
                <Text className="text-dimmed text-xs" numberOfLines={1}>
                  {getHostLabel(item.targetId)} · {item.directory}
                </Text>
              </GlassContainer>
            </Pressable>
          </SwipeableRow>
        )}
      />
    </View>
  );
}
