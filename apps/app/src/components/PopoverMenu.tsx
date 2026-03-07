import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Modal, Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import { Icon, type FeatherIconName } from "./Icon";
import { useThemeColors } from "../constants/colors";

export interface PopoverMenuItem {
  label: string;
  icon: FeatherIconName;
  onPress: () => void;
  destructive?: boolean;
}

interface PopoverMenuProps {
  visible: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<View | null>;
  items: PopoverMenuItem[];
}

const MENU_WIDTH = 200;
const MENU_RIGHT_MARGIN = 12;

export function PopoverMenu({ visible, onClose, anchorRef, items }: PopoverMenuProps): JSX.Element {
  const { border, dimmed } = useThemeColors();
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [anchorPos, setAnchorPos] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [menuHeight, setMenuHeight] = useState(0);
  const [ready, setReady] = useState(false);

  const measure = useCallback(() => {
    anchorRef.current?.measureInWindow((x, y, width, height) => {
      if (x != null && y != null) {
        setAnchorPos({ x, y, width, height });
        setReady(true);
      }
    });
  }, [anchorRef]);

  useEffect(() => {
    if (visible) {
      measure();
      scale.setValue(0);
      opacity.setValue(0);
      backdropOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(scale, {
          toValue: 1,
          damping: 20,
          stiffness: 300,
          mass: 0.8,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      setReady(false);
    }
  }, [visible, measure, scale, opacity, backdropOpacity]);

  const animateClose = useCallback(() => {
    Animated.parallel([
      Animated.timing(scale, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => onClose());
  }, [scale, opacity, backdropOpacity, onClose]);

  const handleItemPress = useCallback((item: PopoverMenuItem) => {
    Animated.parallel([
      Animated.timing(scale, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onClose();
      item.onPress();
    });
  }, [scale, opacity, backdropOpacity, onClose]);

  const onMenuLayout = useCallback((e: LayoutChangeEvent) => {
    setMenuHeight(e.nativeEvent.layout.height);
  }, []);

  // Position: top-right corner of menu aligns with bottom-right of anchor
  const menuTop = anchorPos.y + anchorPos.height + 4;
  const menuRight = MENU_RIGHT_MARGIN;

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={animateClose}>
      <Animated.View style={{ flex: 1, opacity: backdropOpacity }}>
        <Pressable style={{ flex: 1 }} onPress={animateClose}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.15)" }} />
        </Pressable>
      </Animated.View>

      {ready && (
        <Animated.View
          onLayout={onMenuLayout}
          style={{
            position: "absolute",
            top: menuTop,
            right: menuRight,
            width: MENU_WIDTH,
            opacity,
            transform: [
              { scale },
            ],
            transformOrigin: "top right",
          }}
        >
          <View
            className="bg-card rounded-2xl overflow-hidden"
            style={{
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.2,
              shadowRadius: 24,
              elevation: 12,
              borderWidth: 0.5,
              borderColor: border,
            }}
          >
            {items.map((item, index) => (
              <Pressable
                key={item.label}
                className="flex-row items-center gap-3 px-4 py-3.5 active:opacity-80"
                style={index < items.length - 1 ? { borderBottomWidth: 0.5, borderBottomColor: border } : undefined}
                onPress={() => handleItemPress(item)}
                accessibilityRole="button"
                accessibilityLabel={item.label}
              >
                <Icon
                  name={item.icon}
                  size={18}
                  color={item.destructive ? undefined : dimmed}
                />
                <Text
                  className={item.destructive ? "text-error text-[15px] font-medium" : "text-foreground text-[15px]"}
                >
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Animated.View>
      )}
    </Modal>
  );
}
