import React from "react";
import { Pressable, View, Text } from "react-native";
import type { AiMessage } from "../core/types";
import { AiContentBlockView } from "./AiContentBlockView";
import { StreamingDots } from "./StreamingDots";
import { Icon } from "./Icon";
import { useThemeColors } from "../constants/colors";

export const AiMessageBubble = React.memo(function AiMessageBubble({
  message,
  onMenuPress,
  onSendResponse,
}: {
  message: AiMessage;
  onMenuPress?: (message: AiMessage) => void;
  onSendResponse?: (text: string) => void;
}): JSX.Element {
  const { dimmed } = useThemeColors();
  if (message.role === "user") {
    const textContent = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return (
      <View className="self-end bg-muted max-w-[85%] rounded-2xl rounded-br-sm px-3.5 py-2.5">
        <Text selectable className="text-foreground text-[15px] leading-[22px]">
          {textContent}
        </Text>
      </View>
    );
  }

  if (message.role === "system") {
    const textContent = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return (
      <View className="self-center px-3 py-1.5">
        <Text selectable className="text-dimmed text-[13px] italic text-center">
          {textContent}
        </Text>
      </View>
    );
  }

  return (
    <View className="w-full pl-1 gap-3">
      {onMenuPress && (
        <View className="flex-row justify-end">
          <Pressable
            className="px-1.5 py-0.5"
            onPress={() => onMenuPress(message)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Message options"
          >
            <Icon name="more-horizontal" size={18} color={dimmed} />
          </Pressable>
        </View>
      )}
      {message.content.map((block, index) => (
        <AiContentBlockView
          key={index}
          block={block}
          isStreaming={message.isStreaming}
          isLastBlock={index === message.content.length - 1}
          onSendResponse={onSendResponse}
        />
      ))}
      {message.isStreaming === true && <StreamingDots />}
    </View>
  );
});
