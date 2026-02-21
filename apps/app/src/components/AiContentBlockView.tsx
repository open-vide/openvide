import React, { useMemo } from "react";
import { Linking, Platform, Pressable, Text, View } from "react-native";
import Markdown from "react-native-markdown-display";
import { useNavigation } from "@react-navigation/native";
import type { AiContentBlock } from "../core/types";
import { inferLanguageFromPath } from "../core/syntaxHighlight";
import { CodeBlock } from "./CodeBlock";
import { CollapsibleCard } from "./CollapsibleCard";
import { DiffView } from "./DiffView";
import { MonoBlock } from "./MonoBlock";
import { TruncatedText } from "./TruncatedText";
import { ToolUseCard } from "./ToolUseCard";
import { cn } from "../lib/utils";
import { useThemeColors } from "../constants/colors";

// Custom markdown rules for syntax-highlighted fenced code blocks.
// Signature: (node, children, parent, styles, inheritedStyles) per react-native-markdown-display
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const markdownRules: Record<string, (...args: any[]) => React.ReactNode> = {
  fence: (node: { key?: string; sourceInfo?: string; content?: string }) => {
    const lang = (node.sourceInfo ?? "").trim();
    const code = (node.content ?? "").replace(/\n$/, "");
    return (
      <View key={node.key ?? `fence-${code.slice(0, 20)}`} style={{ marginVertical: 6 }}>
        <CodeBlock code={code} language={lang || undefined} showCopyButton />
      </View>
    );
  },
  code_block: (node: { key?: string; content?: string }) => {
    const code = (node.content ?? "").replace(/\n$/, "");
    return (
      <View key={node.key ?? `cb-${code.slice(0, 20)}`} style={{ marginVertical: 6 }}>
        <CodeBlock code={code} showCopyButton />
      </View>
    );
  },
};

export const AiContentBlockView = React.memo(function AiContentBlockView({
  block,
  isStreaming,
  isLastBlock,
  onSendResponse,
  showToolDetails,
}: {
  block: AiContentBlock;
  isStreaming?: boolean;
  isLastBlock?: boolean;
  onSendResponse?: (text: string) => void;
  showToolDetails?: boolean;
}): JSX.Element {
  const navigation = useNavigation<any>();
  const { foreground, mutedForeground, accent, muted, border } = useThemeColors();
  const markdownStyles = useMemo(() => ({
    body: {
      color: foreground,
      fontSize: 15,
      lineHeight: 22,
      flexShrink: 1,
    },
    heading1: {
      color: foreground,
      fontSize: 22,
      fontWeight: "700" as const,
      marginTop: 12,
      marginBottom: 6,
    },
    heading2: {
      color: foreground,
      fontSize: 19,
      fontWeight: "700" as const,
      marginTop: 10,
      marginBottom: 4,
    },
    heading3: {
      color: foreground,
      fontSize: 16,
      fontWeight: "600" as const,
      marginTop: 8,
      marginBottom: 4,
    },
    paragraph: {
      color: foreground,
      fontSize: 15,
      lineHeight: 22,
      marginTop: 0,
      marginBottom: 8,
    },
    strong: {
      color: foreground,
      fontWeight: "700" as const,
    },
    em: {
      color: mutedForeground,
      fontStyle: "italic" as const,
    },
    link: {
      color: accent,
      textDecorationLine: "underline" as const,
    },
    blockquote: {
      backgroundColor: muted,
      borderLeftWidth: 3,
      borderLeftColor: accent,
      paddingLeft: 12,
      paddingVertical: 4,
      marginVertical: 6,
    },
    code_inline: {
      backgroundColor: muted,
      color: foreground,
      fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
      fontSize: 13,
      paddingHorizontal: 5,
      paddingVertical: 2,
      borderRadius: 4,
    },
    code_block: {
      backgroundColor: "#1E1E1E",
      color: "#D4D4D4",
      fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
      fontSize: 13,
      padding: 12,
      borderRadius: 8,
      marginVertical: 6,
    },
    fence: {
      backgroundColor: "#1E1E1E",
      color: "#D4D4D4",
      fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
      fontSize: 13,
      padding: 12,
      borderRadius: 8,
      marginVertical: 6,
    },
    list_item: {
      color: foreground,
      fontSize: 15,
      lineHeight: 22,
    },
    bullet_list: {
      marginVertical: 4,
    },
    ordered_list: {
      marginVertical: 4,
    },
    hr: {
      backgroundColor: border,
      height: 1,
      marginVertical: 12,
    },
    table: {
      borderColor: border,
      borderWidth: 1,
    },
    thead: {
      backgroundColor: muted,
    },
    th: {
      color: foreground,
      fontWeight: "600" as const,
      padding: 6,
      borderColor: border,
    },
    td: {
      color: foreground,
      padding: 6,
      borderColor: border,
    },
  }), [accent, border, foreground, muted, mutedForeground]);

  switch (block.type) {
    case "text":
      return (
        <Markdown
          style={markdownStyles}
          rules={markdownRules}
          onLinkPress={(url: string) => {
            void Linking.openURL(url);
            return false;
          }}
        >
          {block.text ?? ""}
        </Markdown>
      );

    case "thinking": {
      const durationLabel = block.durationMs
        ? ` (${(block.durationMs / 1000).toFixed(1)}s)`
        : "";
      return (
        <CollapsibleCard title={`Thinking...${durationLabel}`} defaultOpen={false}>
          <Markdown
            style={{
              ...markdownStyles,
              body: { ...markdownStyles.body, color: mutedForeground, fontStyle: "italic" as const },
            }}
            rules={markdownRules}
          >
            {block.text ?? ""}
          </Markdown>
        </CollapsibleCard>
      );
    }

    case "tool_use":
      return <ToolUseCard block={block} onSendResponse={onSendResponse} showToolDetails={showToolDetails} />;

    case "tool_result": {
      const resultText = block.result ?? "";
      const trimmedResult = resultText.trim();
      // Skip rendering if the result is just a tool-name echo (e.g. "Read: /path", "Edit: /path")
      // since the ToolUseCard above already displays this info
      if (/^(Read|Edit|Write|Bash|Grep|Glob|MultiEdit):\s/.test(trimmedResult) && !trimmedResult.includes("\n")) {
        return <View />;
      }
      const looksLikeDiff = resultText.includes("@@") && (resultText.includes("---") || resultText.includes("+++"));
      return (
        <View
          className={cn(
            "pl-2.5 border-l-[3px]",
            block.isError ? "border-l-destructive" : "border-l-success",
          )}
        >
          {looksLikeDiff ? (
            <Pressable onPress={() => navigation.navigate("DiffViewer", { diff: resultText })}>
              <DiffView diff={resultText} />
            </Pressable>
          ) : (
            <TruncatedText text={resultText} maxLines={200}>
              {(visibleText) => (
                <MonoBlock text={visibleText} copyable />
              )}
            </TruncatedText>
          )}
        </View>
      );
    }

    case "file_change": {
      const diffContent = block.diff ?? "";
      const hasContent = block.filePath || diffContent.length > 0;
      if (!hasContent) {
        return <View />;
      }
      const lang = block.filePath ? inferLanguageFromPath(block.filePath) : "";
      return (
        <Pressable
          className="bg-muted rounded-2xl p-3 gap-2"
          onPress={() => {
            if (diffContent.length > 0) {
              navigation.navigate("DiffViewer", {
                diff: diffContent,
                filePath: block.filePath,
                language: lang || undefined,
              });
            }
          }}
        >
          {block.filePath ? (
            <Text selectable className="text-foreground font-mono text-[13px] font-semibold">
              {block.filePath}
            </Text>
          ) : null}
          {diffContent.length > 0 && (
            <DiffView diff={diffContent} language={lang || undefined} />
          )}
        </Pressable>
      );
    }

    case "command_exec": {
      return (
        <View className="gap-1.5">
          {/* Command header */}
          <View className="bg-muted rounded-t-lg border border-border px-3 py-2">
            <CodeBlock code={`$ ${block.command}`} language="bash" showCopyButton={true} />
          </View>
          {/* Output */}
          {block.output != null && block.output.length > 0 && (
            <TruncatedText text={block.output} maxLines={200}>
              {(visibleText) => (
                <MonoBlock text={visibleText} copyable />
              )}
            </TruncatedText>
          )}
          {block.exitCode != null && block.exitCode !== 0 && (
            <View className="self-start rounded-md px-2 py-0.5 bg-destructive">
              <Text selectable className="text-white text-[11px] font-bold font-mono">
                exit {block.exitCode}
              </Text>
            </View>
          )}
        </View>
      );
    }

    case "error":
      return (
        <View className="bg-error-bg rounded-lg p-3">
          <Text selectable className="text-destructive text-sm leading-5">
            {block.text}
          </Text>
        </View>
      );

    case "usage":
      return (
        <Text selectable className="text-muted-foreground text-xs leading-4">
          {block.inputTokens} in / {block.outputTokens} out tokens
        </Text>
      );

    case "web_search":
      return (
        <CollapsibleCard title={`Search: ${block.searchQuery ?? "web"}`} defaultOpen={false}>
          {block.searchResults?.map((r, i) => (
            <Pressable
              key={i}
              className="gap-0.5 py-1.5 border-b border-border"
              onPress={() => void Linking.openURL(r.url)}
            >
              <Text selectable className="text-foreground text-sm font-semibold">
                {r.title}
              </Text>
              <Text className="text-accent text-xs underline">
                {r.url}
              </Text>
              <Text selectable className="text-muted-foreground text-[13px] leading-[18px]">
                {r.snippet}
              </Text>
            </Pressable>
          ))}
        </CollapsibleCard>
      );

    default:
      return <View />;
  }
});
