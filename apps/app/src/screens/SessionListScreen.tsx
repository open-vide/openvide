import React, { useCallback, useLayoutEffect, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppStore } from "../state/AppStoreContext";
import { SessionCard } from "../components/SessionCard";
import { SwipeableRow } from "../components/SwipeableRow";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { colors } from "../constants/colors";
import type { MainStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<MainStackParamList, "WorkspaceList">;

export function SessionListScreen({ navigation }: Props): JSX.Element {
  const { sessions, targets, deleteSession } = useAppStore();
  const [refreshing, setRefreshing] = useState(false);
  console.log("[OV:ui] SessionListScreen render:", sessions.length, "sessions,", targets.length, "targets");

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => navigation.getParent()?.navigate("NewSessionSheet" as never)}
          className="w-10 h-10 items-center justify-center active:opacity-80"
        >
          <Icon name="plus" size={24} color={colors.accent} />
        </Pressable>
      ),
    });
  }, [navigation]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    // State is reactive — just toggle refreshing indicator
    setTimeout(() => setRefreshing(false), 500);
  }, []);

  const getHostLabel = (targetId: string): string => {
    const target = targets.find((t) => t.id === targetId);
    return target?.label ?? "Unknown host";
  };

  if (sessions.length === 0) {
    return (
      <View className="flex-1 bg-background">
        <EmptyState
          icon="message-circle"
          message="Start your first AI session"
          actionLabel="New Session"
          onAction={() => navigation.getParent()?.navigate("NewSessionSheet" as never)}
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        windowSize={10}
        maxToRenderPerBatch={8}
        removeClippedSubviews
        renderItem={({ item }) => (
          <SwipeableRow
            onDelete={() => deleteSession(item.id)}
            confirmTitle="Delete Session"
            confirmMessage={`Delete this ${item.tool} session? This cannot be undone.`}
          >
            <SessionCard
              session={item}
              hostLabel={getHostLabel(item.targetId)}
              onPress={() => navigation.navigate("AiChat", { sessionId: item.id })}
            />
          </SwipeableRow>
        )}
      />
    </View>
  );
}
