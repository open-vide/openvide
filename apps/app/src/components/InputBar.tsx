import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, LayoutAnimation, Platform, Pressable, TextInput, UIManager, View } from "react-native";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { cn } from "../lib/utils";
import { Icon } from "./Icon";
import { useThemeColors } from "../constants/colors";

const BAR_COUNT = 24;

function WaveformBars() {
  const { accent } = useThemeColors();
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
            backgroundColor: accent,
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
  const { accent, dimmed } = useThemeColors();
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

  // When running with no text typed: show Cancel
  // When running with text typed: show Send (queues the message)
  // When idle: show Send
  const showCancel = isRunning && !hasText && !isListening;

  return (
    <View style={{ paddingBottom: Math.max(12, inset), paddingTop: 12 }}>
    <View className="flex-row items-end px-3 gap-2">
      {/* Text field / waveform area */}
      <View className="flex-1 flex-row items-end bg-muted rounded-2xl" style={{ minHeight: 54 }}>
        {isListening ? (
          <WaveformBars />
        ) : (
          <TextInput
            className="flex-1 text-foreground text-[16px] pl-4 pr-1 max-h-[120px]"
            style={{ paddingTop: 8, paddingBottom: 18 }}
            value={text}
            onChangeText={onChangeText}
            placeholder={
              isRunning && !hasText ? "Running\u2026 type to queue" : placeholder
            }
            placeholderTextColor={dimmed}
            multiline
            maxLength={4000}
            returnKeyType="default"
            accessibilityLabel="Message input"
          />
        )}
        {/* Mic / Send button inside the text field */}
        {!isListening && (
          <Pressable
            className="h-[54px] items-center justify-center pl-2 pr-3 active:opacity-80"
            onPress={hasText ? handleSend : handleMicPress}
            accessibilityRole="button"
            accessibilityLabel={hasText ? "Send" : "Voice input"}
          >
            {hasText ? (
              <View className="w-9 h-9 rounded-full bg-accent items-center justify-center">
                <Icon name="send" size={18} color="#FFFFFF" />
              </View>
            ) : (
              <Icon name="mic" size={22} color={dimmed} />
            )}
          </Pressable>
        )}
      </View>

      {/* External button: only for cancel (running) or voice-listening stop */}
      {isListening ? (
        <Pressable
          className="bg-foreground w-[54px] h-[54px] rounded-full items-center justify-center active:opacity-80"
          onPress={handleMicPress}
          accessibilityRole="button"
          accessibilityLabel="Stop listening"
        >
          <Animated.View style={{ opacity: pulseAnim }}>
            <Icon name="mic" size={20} color="#FFFFFF" />
          </Animated.View>
        </Pressable>
      ) : showCancel ? (
        <Pressable
          className="bg-destructive w-[54px] h-[54px] rounded-full items-center justify-center active:opacity-80"
          onPress={() => onCancel?.()}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <Icon name="x" size={20} color="#FFFFFF" />
        </Pressable>
      ) : null}
    </View>
    </View>
  );
}
