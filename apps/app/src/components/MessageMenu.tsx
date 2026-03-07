import React from "react";
import { ActionSheetIOS, Platform, Pressable, Text, View, Modal, Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { AiMessage } from "../core/types";
import { GlassContainer } from "./GlassContainer";

export function MessageMenu({
  message,
  visible,
  onClose,
}: {
  message: AiMessage | null;
  visible: boolean;
  onClose: () => void;
}): JSX.Element | null {
  if (!message || !visible) return null;

  const fullText = extractAllText(message);
  const codeBlocks = extractCodeBlocks(fullText);
  const hasCode = codeBlocks.length > 0;

  const handleCopyAll = async (): Promise<void> => {
    await Clipboard.setStringAsync(fullText);
    onClose();
  };

  const handleCopyCode = async (): Promise<void> => {
    await Clipboard.setStringAsync(codeBlocks.join("\n\n"));
    onClose();
  };

  const handleShare = async (): Promise<void> => {
    await Share.share({ message: fullText });
    onClose();
  };

  if (Platform.OS === "ios") {
    const options = ["Copy All", ...(hasCode ? ["Copy Code"] : []), "Share", "Cancel"];
    const cancelButtonIndex = options.length - 1;

    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex },
      (buttonIndex) => {
        if (buttonIndex === 0) void handleCopyAll();
        else if (hasCode && buttonIndex === 1) void handleCopyCode();
        else if (buttonIndex === (hasCode ? 2 : 1)) void handleShare();
        else onClose();
      },
    );
    return null;
  }

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/50 justify-end" onPress={onClose}>
        <GlassContainer variant="sheet" className="pb-[34px] pt-2">
          <Pressable className="py-4 px-5" onPress={() => void handleCopyAll()} accessibilityRole="button" accessibilityLabel="Copy all text">
            <Text className="text-foreground text-[17px]">Copy All</Text>
          </Pressable>
          {hasCode && (
            <Pressable className="py-4 px-5" onPress={() => void handleCopyCode()} accessibilityRole="button" accessibilityLabel="Copy code blocks">
              <Text className="text-foreground text-[17px]">Copy Code</Text>
            </Pressable>
          )}
          <Pressable className="py-4 px-5" onPress={() => void handleShare()} accessibilityRole="button" accessibilityLabel="Share message">
            <Text className="text-foreground text-[17px]">Share</Text>
          </Pressable>
          <Pressable className="py-4 px-5 border-t border-border mt-2" onPress={onClose} accessibilityRole="button" accessibilityLabel="Cancel">
            <Text className="text-error text-[17px] font-semibold">Cancel</Text>
          </Pressable>
        </GlassContainer>
      </Pressable>
    </Modal>
  );
}

function extractAllText(message: AiMessage): string {
  return message.content
    .map((b) => {
      if (b.type === "text") return b.text ?? "";
      if (b.type === "thinking") return b.text ?? "";
      if (b.type === "tool_result") return b.result ?? "";
      if (b.type === "command_exec") return `$ ${b.command ?? ""}\n${b.output ?? ""}`;
      if (b.type === "error") return b.text ?? "";
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function extractCodeBlocks(text: string): string[] {
  const regex = /```[\s\S]*?\n([\s\S]*?)```/g;
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const captured = match[1];
    if (captured && captured.trim().length > 0) blocks.push(captured.trim());
  }
  return blocks;
}
