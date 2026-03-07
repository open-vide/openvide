import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Icon } from "./Icon";
import { cn } from "../lib/utils";
import { useThemeColors } from "../constants/colors";
import type { AiSession } from "../core/types";

interface ChatTabBarProps {
  sessions: AiSession[];
  activeSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onNewSession: () => void;
}

function StatusDot({ status }: { status: AiSession["status"] }): JSX.Element {
  const colorClass =
    status === "running" ? "bg-success" :
      status === "awaiting_input" ? "bg-warning" :
        status === "failed" ? "bg-destructive" :
          "bg-muted-foreground";
  return <View className={cn("w-1.5 h-1.5 rounded-full", colorClass)} />;
}

export function ChatTabBar({
  sessions,
  activeSessionId,
  onSelectSession,
  onCloseSession,
  onNewSession,
}: ChatTabBarProps): JSX.Element | null {
  const { accent, mutedForeground } = useThemeColors();

  if (sessions.length === 0) return null;

  return (
    <View className="border-b border-border bg-card">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 8, paddingVertical: 6, gap: 4 }}
        keyboardShouldPersistTaps="handled"
      >
        {sessions.map((session) => {
          const isActive = session.id === activeSessionId;
          const title = session.messages[0]?.content[0]?.text?.slice(0, 20) ?? session.tool;
          return (
            <Pressable
              key={session.id}
              className={cn(
                "flex-row items-center gap-1.5 px-3 py-1.5 rounded-lg active:opacity-80",
                isActive ? "bg-accent/15" : "bg-muted",
              )}
              onPress={() => onSelectSession(session.id)}
            >
              <StatusDot status={session.status} />
              <Text
                className={cn(
                  "text-xs font-semibold",
                  isActive ? "text-accent" : "text-muted-foreground",
                )}
                numberOfLines={1}
                style={{ maxWidth: 100 }}
              >
                {title}
              </Text>
              <Pressable
                className="w-4 h-4 items-center justify-center active:opacity-80"
                onPress={(e) => {
                  e.stopPropagation();
                  onCloseSession(session.id);
                }}
                hitSlop={8}
              >
                <Icon name="x" size={10} color={isActive ? accent : mutedForeground} />
              </Pressable>
            </Pressable>
          );
        })}
        <Pressable
          className="w-7 h-7 rounded-lg bg-muted items-center justify-center active:opacity-80"
          onPress={onNewSession}
        >
          <Icon name="plus" size={14} color={mutedForeground} />
        </Pressable>
      </ScrollView>
    </View>
  );
}
