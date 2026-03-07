import React, { useMemo } from "react";
import { PanResponder, Pressable, Text, View } from "react-native";
import { Icon } from "./Icon";
import { useThemeColors } from "../constants/colors";

interface SpecialKey {
  label: string;
  value: string;
}

const SPECIAL_KEYS: SpecialKey[] = [
  { label: "esc", value: "\x1B" },
  { label: "ctrl ^", value: "\x1E" },
  { label: "tab", value: "\t" },
  { label: "~", value: "~" },
  { label: "|", value: "|" },
];

export function TerminalSpecialKeysBar({
  onKey,
  keyboardVisible,
  onToggleKeyboard,
  bottomOffset,
  backgroundColor,
  textColor,
  accentColor,
}: {
  onKey: (value: string) => void;
  keyboardVisible: boolean;
  onToggleKeyboard: () => void;
  bottomOffset: number;
  backgroundColor?: string;
  textColor?: string;
  accentColor?: string;
}): JSX.Element {
  const { mutedForeground, accent } = useThemeColors();
  const resolvedBackgroundColor = backgroundColor ?? "rgba(15, 15, 17, 0.92)";
  const resolvedTextColor = textColor ?? mutedForeground;
  const resolvedAccentColor = accentColor ?? accent;
  const joystickResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 8 || Math.abs(gesture.dy) > 8,
    onPanResponderRelease: (_, gesture) => {
      const absX = Math.abs(gesture.dx);
      const absY = Math.abs(gesture.dy);
      if (Math.max(absX, absY) < 18) {
        return;
      }
      if (absY > absX) {
        onKey(gesture.dy < 0 ? "\x1B[A" : "\x1B[B");
        return;
      }
      onKey(gesture.dx < 0 ? "\x1B[D" : "\x1B[C");
    },
  }), [onKey]);

  return (
    <View className="absolute left-0 right-0 px-3" pointerEvents="box-none" style={{ bottom: bottomOffset }}>
      <View className="flex-row items-center justify-between gap-2">
        <View
          className="flex-1 flex-row items-center gap-2 px-3 h-14 rounded-full"
          style={{ backgroundColor: resolvedBackgroundColor }}
        >
          {SPECIAL_KEYS.map((key) => (
            <Pressable
              key={key.label}
              className="h-10 px-2 rounded-full items-center justify-center active:opacity-80"
              onPress={() => onKey(key.value)}
            >
              <Text
                className="text-[12px] font-mono font-semibold"
                style={{ color: resolvedTextColor }}
              >
                {key.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          className="w-14 h-14 rounded-full items-center justify-center active:opacity-80"
          style={{ backgroundColor: resolvedBackgroundColor }}
          onPress={onToggleKeyboard}
          accessibilityRole="button"
          accessibilityLabel={keyboardVisible ? "Hide keyboard" : "Show keyboard"}
        >
          <Icon name={keyboardVisible ? "chevron-down" : "command"} size={18} color={resolvedTextColor} />
        </Pressable>

        <View
          {...joystickResponder.panHandlers}
          className="w-14 h-14 rounded-full items-center justify-center"
          style={{ backgroundColor: resolvedBackgroundColor }}
        >
          <View className="absolute top-2">
            <Icon name="chevron-up" size={12} color={resolvedTextColor} />
          </View>
          <View className="absolute bottom-2">
            <Icon name="chevron-down" size={12} color={resolvedTextColor} />
          </View>
          <View className="absolute left-2">
            <Icon name="chevron-left" size={12} color={resolvedTextColor} />
          </View>
          <View className="absolute right-2">
            <Icon name="chevron-right" size={12} color={resolvedTextColor} />
          </View>
          <Icon name="crosshair" size={15} color={resolvedAccentColor} />
        </View>
      </View>
    </View>
  );
}
