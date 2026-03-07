import React from "react";
import { Pressable, Text, View } from "react-native";
import { formatRelativeTime } from "../core/formatTime";
import type { AiSession } from "../core/types";
import { ProviderIcon } from "./ProviderIcon";

import { GlassContainer } from "./GlassContainer";

function extractPreview(session: AiSession): string {
  const messages = session.messages;
  if (messages.length === 0) return "No messages yet";
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) return "No messages yet";
  for (const block of lastMessage.content) {
    if (block.type === "text" && block.text) return block.text;
  }
  return "No text content";
}

export const SessionCard = React.memo(function SessionCard({
  session,
  hostLabel,
  onPress,
}: {
  session: AiSession;
  hostLabel?: string;
  onPress: () => void;
}): JSX.Element {
  const preview = extractPreview(session);
  const relativeTime = formatRelativeTime(session.updatedAt);

  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <GlassContainer variant="card" className="p-3.5 gap-2.5">
        <View className="flex-row justify-between items-center">
          <ProviderIcon tool={session.tool as "claude" | "codex"} size={20} />
          <Text className="text-muted-foreground text-xs">{relativeTime}</Text>
        </View>
        <Text className="text-foreground text-sm" numberOfLines={1}>
          {preview}
        </Text>
        {hostLabel ? (
          <Text className="text-dimmed text-xs">{hostLabel}</Text>
        ) : null}
      </GlassContainer>
    </Pressable>
  );
});
