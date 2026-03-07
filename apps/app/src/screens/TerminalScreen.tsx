import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Keyboard, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAppStore } from "../state/AppStoreContext";
import { buildColoredReadableDisplay, type TerminalColoredLine } from "../core/terminalView";
import { TerminalSpecialKeysBar } from "../components/TerminalSpecialKeysBar";
import { Icon } from "../components/Icon";
import { PopoverMenu, type PopoverMenuItem } from "../components/PopoverMenu";
import { useThemeColors } from "../constants/colors";
import type { RunRecord } from "../core/types";
import type { MainStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<MainStackParamList, "Terminal">;

const FLOATING_DOCK_HEIGHT = 56;

interface TerminalPalette {
  background: string;
  defaultText: string;
  cursorText: string;
  cursorBackground: string;
  dockBackground: string;
  dockText: string;
  keyboardAppearance: "light" | "dark";
}

const BlinkingCursor = React.memo(function BlinkingCursor({
  color,
  backgroundColor,
}: {
  color: string;
  backgroundColor: string;
}): JSX.Element {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible((prev) => !prev);
    }, 530);
    return () => clearInterval(interval);
  }, []);

  return (
    <Text
      style={{
        color,
        backgroundColor: visible ? backgroundColor : "transparent",
        fontWeight: "700",
      }}
    >
      {visible ? " " : ""}
    </Text>
  );
});

export function TerminalScreen({ route, navigation }: Props): JSX.Element {
  const { targetId, initialDirectory } = route.params;
  const {
    getTarget,
    getRun,
    startCommandRun,
    sendRunInput,
    subscribeRun,
    cancelRun,
  } = useAppStore();

  const { background, border, foreground, muted, mutedForeground, resolvedColorScheme } = useThemeColors();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const target = getTarget(targetId);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [terminalLines, setTerminalLines] = useState<TerminalColoredLine[]>([]);
  const [terminalCursor, setTerminalCursor] = useState<{ row: number; col: number } | null>(null);
  const [runStatus, setRunStatus] = useState<RunRecord["status"] | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [menuVisible, setMenuVisible] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const hiddenInputRef = useRef<TextInput>(null);
  const latestTerminalTextRef = useRef("");
  const hiddenInputBufferRef = useRef("");
  const menuAnchorRef = useRef<View>(null);
  const mountedRef = useRef(true);
  const activeRunIdRef = useRef<string | null>(null);
  const runStatusRef = useRef<RunRecord["status"] | null>(null);
  const startSessionPromiseRef = useRef<Promise<void> | null>(null);
  const autoRestartCountRef = useRef(0);
  const isLightMode = resolvedColorScheme === "light";
  const terminalTheme = useMemo<TerminalPalette>(() => ({
    background: isLightMode ? background : "#050608",
    defaultText: isLightMode ? foreground : "#D4D4D4",
    cursorText: isLightMode ? background : "#050608",
    cursorBackground: isLightMode ? foreground : "#E8E3DA",
    dockBackground: isLightMode ? muted : "rgba(15, 15, 17, 0.92)",
    dockText: isLightMode ? mutedForeground : "#AAA59C",
    keyboardAppearance: isLightMode ? "light" : "dark",
  }), [background, foreground, isLightMode, muted, mutedForeground]);

  const handleTerminalCopy = useCallback(() => {
    if (latestTerminalTextRef.current) {
      void Clipboard.setStringAsync(latestTerminalTextRef.current);
    }
  }, []);

  const handleCloseTerminal = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const menuItems = useMemo((): PopoverMenuItem[] => [
    {
      label: "Copy Terminal",
      icon: "copy",
      onPress: handleTerminalCopy,
    },
    {
      label: "Close Terminal",
      icon: "x-circle",
      onPress: handleCloseTerminal,
      destructive: true,
    },
  ], [handleCloseTerminal, handleTerminalCopy]);

  useEffect(() => {
    activeRunIdRef.current = activeRunId;
  }, [activeRunId]);

  useEffect(() => {
    runStatusRef.current = runStatus;
  }, [runStatus]);

  const applyRunState = useCallback((run: RunRecord) => {
    const display = buildColoredReadableDisplay(run, { maxLines: 500 });
    setTerminalLines(display.lines);
    latestTerminalTextRef.current = display.text;
    setTerminalCursor(display.cursor ?? null);
    setRunStatus(run.status);
  }, []);

  useEffect(() => {
    if (!activeRunId) return;
    const currentRun = getRun(activeRunId);
    if (currentRun) {
      applyRunState(currentRun);
    }
    const unsub = subscribeRun(activeRunId, applyRunState);
    return unsub;
  }, [activeRunId, applyRunState, getRun, subscribeRun]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false }));
  }, []);

  // Scroll on new output
  useEffect(() => {
    scrollToBottom();
  }, [scrollToBottom, terminalCursor, terminalLines]);

  // Scroll on keyboard show/hide
  useEffect(() => {
    const applyKeyboardFrame = (event: { endCoordinates: { height: number; screenY: number } }) => {
      if (Platform.OS === "android") {
        // On Android with softwareKeyboardLayoutMode: "resize", window.height
        // already shrinks so overlap calculation fails. Use height directly.
        setKeyboardVisible(true);
        setKeyboardHeight(event.endCoordinates.height);
      } else {
        const overlap = Math.max(0, window.height - event.endCoordinates.screenY);
        setKeyboardVisible(overlap > 0);
        setKeyboardHeight(overlap > 0 ? overlap : event.endCoordinates.height);
      }
      scrollToBottom();
    };
    const resetKeyboardFrame = () => {
      setKeyboardVisible(false);
      setKeyboardHeight(0);
      scrollToBottom();
    };

    const showSub = Keyboard.addListener("keyboardDidShow", applyKeyboardFrame);
    const hideSub = Keyboard.addListener("keyboardDidHide", resetKeyboardFrame);
    const changeSub = Platform.OS === "ios"
      ? Keyboard.addListener("keyboardWillChangeFrame", applyKeyboardFrame)
      : null;

    return () => {
      showSub.remove();
      hideSub.remove();
      changeSub?.remove();
    };
  }, [scrollToBottom, window.height]);

  const shellBootstrapCommand = useMemo(() => {
    const shellEscape = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;
    return initialDirectory ? `cd ${shellEscape(initialDirectory)}` : ":";
  }, [initialDirectory]);

  const startTerminalSession = useCallback(async (options?: { focusKeyboard?: boolean }) => {
    if (startSessionPromiseRef.current) {
      await startSessionPromiseRef.current;
      return;
    }

    const shouldFocusKeyboard = options?.focusKeyboard ?? false;
    const promise = (async () => {
      try {
        setRunStatus("connecting");
        const run = await startCommandRun({
          targetId,
          command: shellBootstrapCommand,
          timeoutSec: 86400,
          sourceManagedEnv: true,
        });
        if (!mountedRef.current) {
          await cancelRun(run.id);
          return;
        }
        activeRunIdRef.current = run.id;
        setActiveRunId(run.id);
        setRunStatus(run.status);
        if (shouldFocusKeyboard) {
          requestAnimationFrame(() => hiddenInputRef.current?.focus());
        }
      } catch (_) {
        if (mountedRef.current) {
          setRunStatus("failed");
        }
      }
    })();

    startSessionPromiseRef.current = promise;
    try {
      await promise;
    } finally {
      if (startSessionPromiseRef.current === promise) {
        startSessionPromiseRef.current = null;
      }
    }
  }, [cancelRun, shellBootstrapCommand, startCommandRun, targetId]);

  const ensureTerminalSession = useCallback(async () => {
    const currentRunId = activeRunIdRef.current;
    const currentStatus = currentRunId
      ? getRun(currentRunId)?.status ?? runStatusRef.current
      : runStatusRef.current;

    if (currentStatus === "connecting" || currentStatus === "running") {
      return;
    }

    await startTerminalSession();
  }, [getRun, startTerminalSession]);

  // Start a persistent interactive shell on mount.
  useEffect(() => {
    void startTerminalSession({ focusKeyboard: true });
  }, [startTerminalSession]);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      void ensureTerminalSession();
    });
    return unsubscribe;
  }, [ensureTerminalSession, navigation]);

  useEffect(() => {
    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") {
        setKeyboardVisible(false);
        setKeyboardHeight(0);
        return;
      }

      setKeyboardVisible(false);
      setKeyboardHeight(0);
      requestAnimationFrame(scrollToBottom);
      void ensureTerminalSession();
    });

    return () => {
      appStateSub.remove();
    };
  }, [ensureTerminalSession, scrollToBottom]);

  // Auto-restart terminal session when the run dies while app is foregrounded.
  // This handles the race where resetAllConnections() kills SSH ~1s after foreground,
  // causing the run to fail after ensureTerminalSession already bailed out.
  useEffect(() => {
    if (!runStatus || runStatus === "connecting" || runStatus === "running") {
      autoRestartCountRef.current = 0;
      return;
    }
    if (AppState.currentState !== "active") {
      return;
    }
    if (autoRestartCountRef.current >= 2) {
      return;
    }

    const timer = setTimeout(() => {
      if (mountedRef.current) {
        autoRestartCountRef.current += 1;
        void ensureTerminalSession();
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [runStatus, ensureTerminalSession]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const runId = activeRunIdRef.current;
      if (runId) {
        void cancelRun(runId);
      }
    };
  }, [cancelRun]);

  // Set header actions
  useEffect(() => {
    const title = target?.label?.trim() || target?.host || "Terminal";
    navigation.setOptions({
      title,
      headerRight: () => (
        <View ref={menuAnchorRef} collapsable={false}>
          <Pressable
            className="w-10 h-10 items-center justify-center active:opacity-80 mr-[-4px]"
            onPress={() => setMenuVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Terminal actions"
          >
            <Icon name="more-vertical" size={20} />
          </Pressable>
        </View>
      ),
    });
  }, [navigation, target]);

  const handleSendInput = useCallback(async (input: string) => {
    if (!activeRunId) return;
    await sendRunInput(activeRunId, input);
  }, [activeRunId, sendRunInput]);

  const handleKeyboardToggle = useCallback(() => {
    if (keyboardVisible) {
      hiddenInputRef.current?.blur();
      Keyboard.dismiss();
      return;
    }
    hiddenInputRef.current?.focus();
  }, [keyboardVisible]);

  const handleHiddenInputChange = useCallback((nextValue: string) => {
    if (!activeRunId) {
      return;
    }

    const previousValue = hiddenInputBufferRef.current;
    if (nextValue === previousValue) {
      return;
    }

    let commonPrefixLength = 0;
    const maxPrefixLength = Math.min(previousValue.length, nextValue.length);
    while (
      commonPrefixLength < maxPrefixLength &&
      previousValue[commonPrefixLength] === nextValue[commonPrefixLength]
    ) {
      commonPrefixLength += 1;
    }

    const removedCount = previousValue.length - commonPrefixLength;
    const insertedText = nextValue.slice(commonPrefixLength);

    if (removedCount > 0) {
      void sendRunInput(activeRunId, "\x7F".repeat(removedCount));
    }
    if (insertedText.length > 0) {
      void sendRunInput(activeRunId, insertedText);
    }

    hiddenInputBufferRef.current = nextValue;
    if (nextValue.length >= 32) {
      hiddenInputBufferRef.current = "";
      hiddenInputRef.current?.clear();
    }
  }, [activeRunId, sendRunInput]);

  const handleHiddenInputKeyPress = useCallback((key: string) => {
    if (!activeRunId) {
      return;
    }
    if (key === "Backspace") {
      void sendRunInput(activeRunId, "\x7F");
      hiddenInputBufferRef.current = hiddenInputBufferRef.current.slice(0, -1);
    }
  }, [activeRunId, sendRunInput]);

  const handleSubmit = useCallback(() => {
    if (!activeRunId) {
      return;
    }
    void sendRunInput(activeRunId, "\n");
    hiddenInputBufferRef.current = "";
    hiddenInputRef.current?.clear();
    scrollToBottom();
    requestAnimationFrame(scrollToBottom);
  }, [activeRunId, sendRunInput]);

  const renderTerminalLine = useCallback((line: TerminalColoredLine, lineIdx: number) => {
    const cursorForLine = terminalCursor && terminalCursor.row === lineIdx ? terminalCursor : null;
    let remainingCursorCol = cursorForLine?.col ?? -1;
    let textOffset = 0;
    const parts: React.ReactNode[] = [];

    const renderCursor = (key: string) => (
      <BlinkingCursor
        key={key}
        color={terminalTheme.cursorText}
        backgroundColor={terminalTheme.cursorBackground}
      />
    );

    for (let spanIdx = 0; spanIdx < line.length; spanIdx += 1) {
      const span = line[spanIdx]!;
      const spanText = span.text;
      if (cursorForLine && remainingCursorCol >= textOffset && remainingCursorCol <= textOffset + spanText.length) {
        const splitPoint = remainingCursorCol - textOffset;
        const before = spanText.slice(0, splitPoint);
        const after = spanText.slice(splitPoint);
        if (before.length > 0) {
          parts.push(
            <Text
              key={`before-${spanIdx}`}
              style={{
                color: span.attrs.fg ?? terminalTheme.defaultText,
                backgroundColor: span.attrs.bg,
                fontWeight: span.attrs.bold ? "700" : undefined,
                fontStyle: span.attrs.italic ? "italic" : undefined,
                textDecorationLine: span.attrs.underline ? "underline" : undefined,
                opacity: span.attrs.dim ? 0.6 : undefined,
              }}
            >
              {before}
            </Text>,
          );
        }
        parts.push(renderCursor(`cursor-${lineIdx}`));
        if (after.length > 0) {
          parts.push(
            <Text
              key={`after-${spanIdx}`}
              style={{
                color: span.attrs.fg ?? terminalTheme.defaultText,
                backgroundColor: span.attrs.bg,
                fontWeight: span.attrs.bold ? "700" : undefined,
                fontStyle: span.attrs.italic ? "italic" : undefined,
                textDecorationLine: span.attrs.underline ? "underline" : undefined,
                opacity: span.attrs.dim ? 0.6 : undefined,
              }}
            >
              {after}
            </Text>,
          );
        }
        remainingCursorCol = -1;
      } else {
        parts.push(
          <Text
            key={`span-${spanIdx}`}
            style={{
              color: span.attrs.fg ?? terminalTheme.defaultText,
              backgroundColor: span.attrs.bg,
              fontWeight: span.attrs.bold ? "700" : undefined,
              fontStyle: span.attrs.italic ? "italic" : undefined,
              textDecorationLine: span.attrs.underline ? "underline" : undefined,
              opacity: span.attrs.dim ? 0.6 : undefined,
            }}
          >
            {spanText}
          </Text>,
        );
      }
      textOffset += spanText.length;
    }

    if (cursorForLine && remainingCursorCol >= textOffset) {
      parts.push(
        <Text key={`pad-${lineIdx}`} style={{ color: terminalTheme.defaultText }}>
          {" ".repeat(Math.max(0, remainingCursorCol - textOffset))}
        </Text>,
      );
      parts.push(renderCursor(`cursor-tail-${lineIdx}`));
    }

    if (parts.length === 0 && cursorForLine) {
      parts.push(renderCursor(`cursor-empty-${lineIdx}`));
    }

    return (
      <Text key={lineIdx} style={{ color: terminalTheme.defaultText }} className="font-mono text-[13px] leading-[19px]">
        {parts.length === 0 ? " " : parts}
      </Text>
    );
  }, [terminalCursor, terminalTheme.cursorBackground, terminalTheme.cursorText, terminalTheme.defaultText]);

  const isRunning = runStatus === "connecting" || runStatus === "running";
  const controlsBottomOffset = keyboardVisible
    ? keyboardHeight + 16
    : Math.max(20, insets.bottom + 10);
  const terminalBottomPadding = controlsBottomOffset + FLOATING_DOCK_HEIGHT + 24;

  if (!target) {
    return (
      <View className="flex-1 bg-background">
        <Text className="text-dimmed text-sm text-center mt-10">Target not found</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: terminalTheme.background }}>
      <View className="flex-1" style={{ backgroundColor: terminalTheme.background }}>
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: 14,
            paddingTop: 16,
            paddingBottom: terminalBottomPadding,
          }}
          keyboardShouldPersistTaps="handled"
          onTouchEnd={() => hiddenInputRef.current?.focus()}
        >
          {terminalLines.length === 0 ? (
            <Text style={{ color: terminalTheme.defaultText }} className="font-mono text-[13px] leading-[19px]">
              {isRunning ? "Connecting shell..." : "Starting terminal..."}
            </Text>
          ) : (
            terminalLines.map((line, lineIdx) => renderTerminalLine(line, lineIdx))
          )}
        </ScrollView>

        <TerminalSpecialKeysBar
          onKey={handleSendInput}
          keyboardVisible={keyboardVisible}
          onToggleKeyboard={handleKeyboardToggle}
          bottomOffset={controlsBottomOffset}
          backgroundColor={terminalTheme.dockBackground}
          textColor={terminalTheme.dockText}
          accentColor={terminalTheme.cursorBackground}
        />

        <TextInput
          ref={hiddenInputRef}
          onChangeText={handleHiddenInputChange}
          onSubmitEditing={handleSubmit}
          onKeyPress={(event) => handleHiddenInputKeyPress(event.nativeEvent.key)}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          blurOnSubmit={false}
          spellCheck={false}
          returnKeyType="default"
          keyboardAppearance={terminalTheme.keyboardAppearance}
          keyboardType={Platform.OS === "ios" ? "ascii-capable" : "default"}
          textContentType="none"
          smartInsertDelete={false}
          className="absolute w-px h-px opacity-0"
          style={{ left: -200, top: 0, color: terminalTheme.defaultText, borderColor: border }}
        />
      </View>

      <PopoverMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        anchorRef={menuAnchorRef}
        items={menuItems}
      />
    </View>
  );
}
