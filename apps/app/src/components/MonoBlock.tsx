import React, { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { cn } from "../lib/utils";
import { CodeBlock } from "./CodeBlock";
import { Icon } from "./Icon";

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
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn("[OV:clipboard] copy failed:", err);
    }
  }, [text]);

  if (language) {
    return <CodeBlock code={text} language={language} showCopyButton />;
  }

  return (
    <View className={cn("bg-muted rounded-lg px-3 py-2.5", bordered && "border-l-[3px] border-l-accent")}>
      {copyable && (
        <Pressable
          onPress={() => void handleCopy()}
          className="absolute top-1.5 right-1.5 z-10 p-1.5 rounded active:opacity-60"
          hitSlop={8}
        >
          <Icon name={copied ? "check" : "copy"} size={13} color={copied ? "#4ade80" : "#8E8E93"} />
        </Pressable>
      )}
      <Text className="text-foreground font-mono text-[13px] leading-5">{text}</Text>
    </View>
  );
}
