import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useThemeColors } from "../constants/colors";

interface SelectionActionBarProps {
  filePath: string;
  selectedText: string;
  startLine: number;
  endLine: number;
  onAskAi: (prompt: string) => void;
}

export function SelectionActionBar({
  filePath,
  selectedText,
  startLine,
  endLine,
  onAskAi,
}: SelectionActionBarProps): JSX.Element {
  const { dimmed } = useThemeColors();
  const [customPromptVisible, setCustomPromptVisible] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");

  const fileName = filePath.split("/").pop() ?? filePath;
  const lineRange = startLine === endLine ? `line ${startLine}` : `lines ${startLine}-${endLine}`;

  const buildPrompt = (instruction: string): string => {
    const truncated = selectedText.length > 4000 ? selectedText.slice(0, 4000) + "\n...[truncated]" : selectedText;
    return `${instruction} from ${fileName} (${lineRange}):\n\`\`\`\n${truncated}\n\`\`\``;
  };

  if (customPromptVisible) {
    return (
      <View className="px-3 py-2 bg-card border-t border-border">
        <View className="flex-row gap-2">
          <TextInput
            className="flex-1 bg-muted rounded-lg px-3 py-2 text-foreground text-sm"
            value={customPrompt}
            onChangeText={setCustomPrompt}
            placeholder="Ask about this code..."
            placeholderTextColor={dimmed}
            autoFocus
            returnKeyType="send"
            onSubmitEditing={() => {
              if (customPrompt.trim()) {
                onAskAi(buildPrompt(customPrompt.trim()));
                setCustomPromptVisible(false);
                setCustomPrompt("");
              }
            }}
          />
          <Pressable
            className="bg-accent rounded-lg px-3 justify-center active:opacity-80"
            onPress={() => {
              if (customPrompt.trim()) {
                onAskAi(buildPrompt(customPrompt.trim()));
                setCustomPromptVisible(false);
                setCustomPrompt("");
              }
            }}
          >
            <Text className="text-white text-xs font-semibold">Send</Text>
          </Pressable>
          <Pressable
            className="bg-muted rounded-lg px-3 justify-center active:opacity-80"
            onPress={() => {
              setCustomPromptVisible(false);
              setCustomPrompt("");
            }}
          >
            <Text className="text-muted-foreground text-xs font-semibold">Cancel</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-row items-center gap-2 px-3 py-2 bg-card border-t border-border">
      <Text className="text-muted-foreground text-xs flex-1" numberOfLines={1}>
        {lineRange} selected
      </Text>
      <Pressable
        className="bg-accent rounded-lg px-3 py-1.5 active:opacity-80"
        onPress={() => onAskAi(buildPrompt("Explain this code"))}
      >
        <Text className="text-white text-xs font-semibold">Explain</Text>
      </Pressable>
      <Pressable
        className="bg-muted rounded-lg px-3 py-1.5 active:opacity-80"
        onPress={() => onAskAi(buildPrompt("Fix this code"))}
      >
        <Text className="text-muted-foreground text-xs font-semibold">Fix</Text>
      </Pressable>
      <Pressable
        className="bg-muted rounded-lg px-3 py-1.5 active:opacity-80"
        onPress={() => setCustomPromptVisible(true)}
      >
        <Text className="text-muted-foreground text-xs font-semibold">Ask...</Text>
      </Pressable>
    </View>
  );
}
