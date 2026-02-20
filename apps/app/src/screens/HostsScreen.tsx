import React, { useCallback, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppStore } from "../state/AppStoreContext";
import { HostCard } from "../components/HostCard";
import { SwipeableRow } from "../components/SwipeableRow";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { colors } from "../constants/colors";
import type { MainStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<MainStackParamList, "Hosts">;

export function HostsScreen({ navigation }: Props): JSX.Element {
  const { targets, deleteTarget } = useAppStore();
  const [refreshing, setRefreshing] = useState(false);
  console.log("[OV:ui] HostsScreen render:", targets.length, "targets");

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 500);
  }, []);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => navigation.getParent()?.navigate("AddHostSheet" as never)}
          className="w-10 h-10 items-center justify-center active:opacity-80"
        >
          <Icon name="plus" size={24} color={colors.accent} />
        </Pressable>
      ),
    });
  }, [navigation]);

  if (targets.length === 0) {
    return (
      <View className="flex-1 bg-background">
        <EmptyState
          icon="monitor"
          message="No hosts configured"
          actionLabel="Add Host"
          onAction={() => navigation.getParent()?.navigate("AddHostSheet" as never)}
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={targets}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        windowSize={10}
        maxToRenderPerBatch={8}
        removeClippedSubviews
        renderItem={({ item }) => (
          <SwipeableRow
            onDelete={() => deleteTarget(item.id)}
            confirmTitle="Delete Host"
            confirmMessage={`Delete "${item.label}"? This also removes all sessions and credentials for this host.`}
          >
            <HostCard
              target={item}
              onPress={() => navigation.navigate("HostDetail", { targetId: item.id })}
            />
          </SwipeableRow>
        )}
      />
    </View>
  );
}
