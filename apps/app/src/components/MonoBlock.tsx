import React, { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { cn } from "../lib/utils";
import { CodeBlock } from "./CodeBlock";

export function MonoBlock({
  text,
  bordered = false,
  language,
  copyable = false,
}: {
  text: string;
  bordered?: boolean;
  language?: string;
  copyable?: boolean;
}): JSX.Element {
  const handleCopy = useCallback(() => {
    void Clipboard.setStringAsync(text);
  }, [text]);

  if (language) {
    return <CodeBlock code={text} language={language} showCopyButton />;
  }

  return (
    <View className={cn("bg-muted rounded-lg px-3 py-2.5", bordered && "border-l-[3px] border-l-accent")}>
      {copyable && (
        <Pressable
          onPress={handleCopy}
          className="absolute top-1.5 right-2 z-10 px-2 py-1 rounded active:opacity-60"
          hitSlop={8}
        >
          <Text className="text-muted-foreground text-[11px]">Copy</Text>
        </Pressable>
      )}
      <Text className="text-foreground font-mono text-[13px] leading-5">{text}</Text>
    </View>
  );
}
