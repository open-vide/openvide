import React, { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

interface TruncatedTextProps {
  text: string;
  maxLines?: number;
  children?: (visibleText: string) => React.ReactNode;
}

export function TruncatedText({
  text,
  maxLines = 200,
  children,
}: TruncatedTextProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  const { visible, hiddenCount } = useMemo(() => {
    const lines = text.split("\n");
    if (expanded || lines.length <= maxLines) {
      return { visible: text, hiddenCount: 0 };
    }
    return {
      visible: lines.slice(0, maxLines).join("\n"),
      hiddenCount: lines.length - maxLines,
    };
  }, [text, maxLines, expanded]);

  return (
    <View>
      {children ? children(visible) : (
        <Text selectable className="text-foreground text-[13px] leading-5 font-mono">
          {visible}
        </Text>
      )}
      {hiddenCount > 0 && (
        <Pressable
          className="mt-1.5 py-1.5 items-center"
          onPress={() => setExpanded(true)}
        >
          <Text className="text-accent text-xs font-semibold">
            Show more ({hiddenCount} lines hidden)
          </Text>
        </Pressable>
      )}
    </View>
  );
}
