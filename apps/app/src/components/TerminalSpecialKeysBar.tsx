import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useThemeColors } from "../constants/colors";

interface SpecialKey {
  label: string;
  value: string;
}

const SPECIAL_KEYS: SpecialKey[] = [
  { label: "Esc", value: "\x1B" },
  { label: "Tab", value: "\t" },
  { label: "Ctrl+C", value: "\x03" },
  { label: "Ctrl+D", value: "\x04" },
  { label: "Ctrl+Z", value: "\x1A" },
  { label: "Ctrl+L", value: "\x0C" },
  { label: "\u2191", value: "\x1B[A" },  // Up arrow
  { label: "\u2193", value: "\x1B[B" },  // Down arrow
  { label: "\u2190", value: "\x1B[D" },  // Left arrow
  { label: "\u2192", value: "\x1B[C" },  // Right arrow
  { label: "~", value: "~" },
  { label: "/", value: "/" },
  { label: "|", value: "|" },
  { label: "-", value: "-" },
];

export function TerminalSpecialKeysBar({
  onKey,
}: {
  onKey: (value: string) => void;
}): JSX.Element {
  const { mutedForeground } = useThemeColors();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 8, paddingVertical: 6, gap: 6 }}
      keyboardShouldPersistTaps="handled"
    >
      {SPECIAL_KEYS.map((key) => (
        <Pressable
          key={key.label}
          className="h-8 px-3 rounded-lg bg-muted items-center justify-center active:opacity-80"
          onPress={() => onKey(key.value)}
        >
          <Text
            className="text-muted-foreground text-xs font-mono font-semibold"
            style={{ color: mutedForeground }}
          >
            {key.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
