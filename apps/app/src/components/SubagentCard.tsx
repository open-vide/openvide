import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { AiContentBlock } from "../core/types";
import { useThemeColors } from "../constants/colors";
import { GlassContainer } from "./GlassContainer";
import { Icon } from "./Icon";
import { StreamingDots } from "./StreamingDots";
import { MonoBlock } from "./MonoBlock";
import { TruncatedText } from "./TruncatedText";

export const SubagentCard = React.memo(function SubagentCard({
  block,
}: {
  block: AiContentBlock;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const colors = useThemeColors();
  const accentColor = colors.accent;

  const name = block.subagentName ?? "Subagent";
  const status = block.subagentStatus ?? "running";
  const prompt = block.subagentPrompt ?? "";
  const result = block.subagentResult ?? "";

  return (
    <Pressable onPress={() => setExpanded((v) => !v)} className="active:opacity-80">
      <GlassContainer variant="card" className="overflow-hidden">
        <View style={{ borderLeftWidth: 3, borderLeftColor: accentColor }}>
          <View className="flex-row items-center justify-between gap-3 px-3.5 py-3">
            <View className="flex-row items-center gap-2.5 shrink">
              <View
                className="w-7 h-7 rounded-full items-center justify-center"
                style={{ backgroundColor: `${accentColor}18` }}
              >
                <Icon name="cpu" size={14} color={accentColor} />
              </View>
              <Text selectable className="text-foreground text-[14px] font-medium shrink">
                {name}
              </Text>
            </View>

            {status === "running" ? (
              <StreamingDots />
            ) : status === "completed" ? (
              <Icon name="check" size={14} color={colors.success} />
            ) : status === "failed" ? (
              <Icon name="alert-circle" size={14} color={colors.destructive} />
            ) : null}
          </View>

          {!expanded && prompt.length > 0 && (
            <View className="px-3.5 pb-3 -mt-1">
              <Text numberOfLines={1} className="text-muted-foreground text-[13px]">
                {prompt}
              </Text>
            </View>
          )}

          {expanded && (
            <View className="px-3.5 pb-3 gap-2 -mt-1">
              {prompt.length > 0 && (
                <TruncatedText text={prompt} maxLines={20}>
                  {(visibleText) => <MonoBlock text={visibleText} />}
                </TruncatedText>
              )}
              {result.length > 0 && (
                <TruncatedText text={result} maxLines={50}>
                  {(visibleText) => <MonoBlock text={visibleText} bordered />}
                </TruncatedText>
              )}
            </View>
          )}
        </View>
      </GlassContainer>
    </Pressable>
  );
});
