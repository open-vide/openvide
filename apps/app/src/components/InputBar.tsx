import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, LayoutAnimation, Platform, Pressable, TextInput, UIManager, View } from "react-native";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { Icon } from "./Icon";
import { useThemeColors } from "../constants/colors";

const BAR_COUNT = 24;

function WaveformBars() {
  const { mutedForeground } = useThemeColors();
  const anims = useMemo(
    () => Array.from({ length: BAR_COUNT }, () => new Animated.Value(0.3)),
    [],
  );

  useEffect(() => {
    const loops = anims.map((anim, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 0.4 + Math.random() * 0.6,
            duration: 200 + Math.random() * 300,
            delay: i * 30,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0.15 + Math.random() * 0.25,
            duration: 200 + Math.random() * 300,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [anims]);

  return (
    <View className="flex-1 flex-row items-center justify-center gap-[3px] px-4 self-center">
      {anims.map((anim, i) => (
        <Animated.View
          key={i}
          style={{
            width: 3,
            height: 24,
            borderRadius: 1.5,
            backgroundColor: mutedForeground,
            transform: [{ scaleY: anim }],
          }}
        />
      ))}
    </View>
  );
}

export function InputBar({
  placeholder = "Type a message\u2026",
  isRunning = false,
  inset = 0,
  text,
  onChangeText,
  onSend,
  onCancel,
  isListening = false,
  onVoiceStart,
  onVoiceEnd,
}: {
  placeholder?: string;
  isRunning?: boolean;
  inset?: number;
  text: string;
  onChangeText: (text: string) => void;
  onSend: (text: string) => void;
  onCancel?: () => void;
  isListening?: boolean;
  onVoiceStart?: () => void;
  onVoiceEnd?: () => void;
}): JSX.Element {
  const { foreground, primaryForeground, mutedForeground, dimmed } = useThemeColors();
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isListening) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.3,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isListening, pulseAnim]);

  const prevListening = useRef(isListening);
  useEffect(() => {
    if (prevListening.current !== isListening) {
      LayoutAnimation.configureNext(
        LayoutAnimation.create(250, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.scaleXY),
      );
      prevListening.current = isListening;
    }
  }, [isListening]);

  const handleSend = (): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (isListening) onVoiceEnd?.();
    onSend(trimmed);
    onChangeText("");
  };

  const hasText = text.trim().length > 0;

  const handleMicPress = () => {
    if (isListening) {
      onVoiceEnd?.();
    } else {
      onVoiceStart?.();
    }
  };

  return (
    <View style={{ paddingBottom: Math.max(12, inset) }}>
      <View className="flex-row items-end px-3 gap-2">
        {/* Left stop-listening button — self-centered so it stays mid-pill */}
        {isListening && (
          <Pressable
            className="w-12 h-12 rounded-full bg-muted items-center justify-center active:opacity-80"
            style={{ alignSelf: "center" }}
            onPress={() => onVoiceEnd?.()}
            accessibilityRole="button"
            accessibilityLabel="Stop listening"
          >
            <Icon name="square" size={14} color={mutedForeground} />
          </Pressable>
        )}

        {/* Main pill container */}
        <View
          className="flex-1 flex-row items-center bg-muted"
          style={{ minHeight: 48, borderRadius: 24 }}
        >
          {isListening ? (
            <WaveformBars />
          ) : (
            <TextInput
              className="flex-1 text-foreground text-[16px] pl-4 pr-2 max-h-[120px]"
              style={{ paddingTop: 14, paddingBottom: 14 }}
              value={text}
              onChangeText={onChangeText}
              placeholder={isRunning && !hasText ? "Running\u2026" : placeholder}
              placeholderTextColor={dimmed}
              multiline
              maxLength={4000}
              returnKeyType="default"
              accessibilityLabel="Message input"
            />
          )}

          {/* Right circular action button */}
          <Pressable
            className="w-10 h-10 rounded-full items-center justify-center active:opacity-80"
            style={{ backgroundColor: foreground, marginRight: 8 }}
            onPress={
              isListening
                ? handleSend
                : isRunning && !hasText
                  ? () => onCancel?.()
                  : hasText
                    ? handleSend
                    : handleMicPress
            }
            accessibilityRole="button"
            accessibilityLabel={
              isListening ? "Send" : isRunning && !hasText ? "Stop" : hasText ? "Send" : "Voice input"
            }
          >
            <Animated.View style={isListening ? { opacity: pulseAnim } : undefined}>
              {isRunning && !hasText ? (
                <Icon name="square" size={14} color={primaryForeground} />
              ) : hasText || isListening ? (
                <Icon name="arrow-up" size={20} color={primaryForeground} />
              ) : (
                <Icon name="mic" size={20} color={primaryForeground} />
              )}
            </Animated.View>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
