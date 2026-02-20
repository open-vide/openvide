import React, { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CommonActions, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAppStore } from "../state/AppStoreContext";
import { useSidebar, type SidebarSection } from "../navigation/SidebarContext";
import type { MainStackParamList, RootStackParamList } from "../navigation/types";
import { cn } from "../lib/utils";
import { colors } from "../constants/colors";
import { Icon, type FeatherIconName } from "./Icon";

type Nav = NativeStackNavigationProp<RootStackParamList>;

const SECTIONS: { key: SidebarSection; label: string; icon: FeatherIconName }[] = [
  { key: "sessions", label: "Workspaces", icon: "message-circle" },
  { key: "hosts", label: "Hosts", icon: "monitor" },
];

const ROOT_SCREEN: Record<SidebarSection, keyof MainStackParamList> = {
  sessions: "WorkspaceList",
  hosts: "Hosts",
  settings: "Settings",
};

export function SidebarContent(): JSX.Element {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { activeSection, setActiveSection, closeSidebar } = useSidebar();
  const { workspaces, getTarget } = useAppStore();
  const [search, setSearch] = useState("");

  const filteredWorkspaces = useMemo(() => {
    const sorted = [...workspaces].sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
    if (!search.trim()) return sorted.slice(0, 30);
    const q = search.toLowerCase();
    return sorted
      .filter((workspace) => {
        const target = getTarget(workspace.targetId);
        const hostLabel = target?.label ?? "";
        return (
          workspace.name.toLowerCase().includes(q) ||
          workspace.directory.toLowerCase().includes(q) ||
          hostLabel.toLowerCase().includes(q)
        );
      })
      .slice(0, 30);
  }, [workspaces, search, getTarget]);

  const switchSection = useCallback(
    (section: SidebarSection) => {
      setActiveSection(section);
      closeSidebar();
      const screen = ROOT_SCREEN[section];
      navigation.dispatch((state) =>
        CommonActions.reset({
          ...state,
          index: 0,
          routes: [{
            ...state.routes[0],
            state: { index: 0, routes: [{ name: screen }] },
          } as never],
        }),
      );
    },
    [setActiveSection, closeSidebar, navigation],
  );

  const openWorkspace = useCallback((workspaceId: string) => {
    setActiveSection("sessions");
    closeSidebar();
    navigation.navigate("Main", { screen: "WorkspaceDetail", params: { workspaceId } });
  }, [setActiveSection, closeSidebar, navigation]);

  const openCreateWorkspace = useCallback(() => {
    setActiveSection("sessions");
    closeSidebar();
    navigation.navigate("CreateWorkspaceSheet");
  }, [setActiveSection, closeSidebar, navigation]);

  const openSettings = useCallback(() => {
    switchSection("settings");
  }, [switchSection]);

  return (
    <View className="flex-1 bg-background overflow-hidden" style={{ paddingTop: insets.top + 12 }}>
      <View className="px-4 mb-4">
        <View className="bg-muted rounded-2xl px-4 h-12 flex-row items-center overflow-hidden">
          <Icon name="search" size={16} color={colors.dimmed} />
          <TextInput
            className="flex-1 text-foreground text-[16px] ml-2"
            placeholder="Search workspaces..."
            placeholderTextColor={colors.dimmed}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")} hitSlop={8}>
              <Icon name="x" size={14} color={colors.dimmed} />
            </Pressable>
          )}
        </View>
      </View>

      <View className="px-4 mb-4">
        {SECTIONS.map((section) => {
          const isActive = activeSection === section.key;
          return (
            <Pressable
              key={section.key}
              onPress={() => switchSection(section.key)}
              className={cn(
                "flex-row items-center px-3.5 h-12 rounded-lg mb-1",
                isActive ? "bg-muted" : "active:bg-muted/50",
              )}
            >
              <View className="mr-3">
                <Icon name={section.icon} size={18} color={isActive ? colors.accent : colors.foreground} />
              </View>
              <Text
                className={cn(
                  "text-[17px] font-medium",
                  isActive ? "text-accent font-semibold" : "text-foreground",
                )}
              >
                {section.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View className="px-4 mb-2 flex-row items-center justify-between">
        <Text className="text-dimmed text-xs font-semibold uppercase tracking-wider">
          Workspaces
        </Text>
        <Pressable
          onPress={openCreateWorkspace}
          className="w-8 h-8 items-center justify-center rounded-full active:bg-muted"
        >
          <Icon name="plus" size={16} color={colors.accent} />
        </Pressable>
      </View>

      <FlatList
        data={filteredWorkspaces}
        keyExtractor={(item) => item.id}
        className="flex-1 px-4"
        renderItem={({ item }) => {
          const target = getTarget(item.targetId);
          const hostLabel = target?.label ?? "Unknown host";
          return (
            <Pressable
              onPress={() => openWorkspace(item.id)}
              className="py-2.5 px-3 rounded-lg mb-0.5 active:bg-muted/50 flex-row items-center gap-2.5 overflow-hidden"
            >
              <Icon name="folder" size={18} color={colors.accent} />
              <View className="flex-1">
                <Text className="text-foreground text-[15px]" numberOfLines={1}>
                  {item.name}
                </Text>
                <Text className="text-dimmed text-[13px] mt-0.5" numberOfLines={1}>
                  {hostLabel} · {item.directory}
                </Text>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View className="px-3 py-4">
            <Text className="text-dimmed text-sm">
              {search ? "No matching workspaces" : "No workspaces yet"}
            </Text>
          </View>
        }
      />

      <View
        className="px-4 pb-2 pt-3 border-t border-border"
        style={{ paddingBottom: insets.bottom + 8 }}
      >
        <Pressable
          onPress={openSettings}
          className={cn(
            "flex-row items-center px-3.5 h-12 rounded-lg",
            activeSection === "settings" ? "bg-muted" : "active:bg-muted/50",
          )}
        >
          <View className="mr-3">
            <Icon name="settings" size={18} color={activeSection === "settings" ? colors.accent : colors.foreground} />
          </View>
          <Text
            className={cn(
              "text-[17px] font-medium",
              activeSection === "settings" ? "text-accent font-semibold" : "text-foreground",
            )}
          >
            Settings
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
