import React, { useCallback, useRef } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { colors } from "../constants/colors";

const SNAP_OPEN = -80;
const SNAP_CLOSED = 0;
const VELOCITY_THRESHOLD = 500;
const SPRING_CONFIG = { damping: 20, stiffness: 200, mass: 0.8 };

interface SwipeableRowProps {
  onDelete: () => void;
  confirmTitle?: string;
  confirmMessage?: string;
  enabled?: boolean;
  children: React.ReactNode;
}

export function SwipeableRow({
  onDelete,
  confirmTitle = "Delete",
  confirmMessage = "Are you sure you want to delete this item?",
  enabled = true,
  children,
}: SwipeableRowProps): JSX.Element {
  const translateX = useSharedValue(0);
  const startX = useSharedValue(0);
  const isDeleting = useSharedValue(false);
  const rowHeight = useSharedValue(0);
  const rowOpacity = useSharedValue(1);
  const measuredHeight = useRef(0);

  const closeRow = useCallback(() => {
    translateX.value = withSpring(SNAP_CLOSED, SPRING_CONFIG);
  }, [translateX]);

  const confirmDelete = useCallback(() => {
    Alert.alert(confirmTitle, confirmMessage, [
      { text: "Cancel", style: "cancel", onPress: () => closeRow() },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          isDeleting.value = true;
          rowHeight.value = measuredHeight.current;
          rowOpacity.value = withTiming(0, { duration: 200, easing: Easing.inOut(Easing.ease) });
          rowHeight.value = withTiming(
            0,
            { duration: 300, easing: Easing.inOut(Easing.ease) },
            (finished) => {
              if (finished) runOnJS(onDelete)();
            },
          );
        },
      },
    ]);
  }, [confirmTitle, confirmMessage, onDelete, closeRow, rowOpacity, rowHeight, isDeleting]);

  const pan = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-10, 10])
    .enabled(enabled)
    .onStart(() => {
      "worklet";
      startX.value = translateX.value;
    })
    .onUpdate((event) => {
      "worklet";
      translateX.value = Math.min(SNAP_CLOSED, Math.max(SNAP_OPEN, startX.value + event.translationX));
    })
    .onEnd((event) => {
      "worklet";
      const pastThreshold = translateX.value < SNAP_OPEN / 2;
      const fastSwipe = event.velocityX < -VELOCITY_THRESHOLD;
      translateX.value = withSpring(
        pastThreshold || fastSwipe ? SNAP_OPEN : SNAP_CLOSED,
        SPRING_CONFIG,
      );
    });

  const foregroundStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const backgroundOpacity = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.abs(translateX.value) / Math.abs(SNAP_OPEN)),
  }));

  const containerStyle = useAnimatedStyle(() => {
    if (!isDeleting.value) {
      return { opacity: 1 };
    }
    return {
      opacity: rowOpacity.value,
      height: rowHeight.value,
      overflow: "hidden" as const,
    };
  });

  const handleLayout = useCallback(
    (event: { nativeEvent: { layout: { height: number } } }) => {
      if (measuredHeight.current === 0) {
        measuredHeight.current = event.nativeEvent.layout.height;
      }
    },
    [],
  );

  return (
    <Animated.View style={containerStyle} onLayout={handleLayout}>
      <View className="relative">
        <Animated.View
          style={[StyleSheet.absoluteFill, {
            backgroundColor: colors.destructive,
            borderRadius: 18,
            justifyContent: "center",
            alignItems: "flex-end",
          }, backgroundOpacity]}
        >
          <Pressable className="w-20 h-full justify-center items-center" onPress={confirmDelete}>
            <Text className="text-white text-sm font-semibold">Delete</Text>
          </Pressable>
        </Animated.View>
        <GestureDetector gesture={pan}>
          <Animated.View style={foregroundStyle}>{children}</Animated.View>
        </GestureDetector>
      </View>
    </Animated.View>
  );
}
