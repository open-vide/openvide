import React, { useCallback } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { tokenize, ONE_DARK_COLORS, type HighlightToken } from "../core/syntaxHighlight";

interface CodeBlockProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
  showCopyButton?: boolean;
  maxLines?: number;
  selectable?: boolean;
}

const FONT_FAMILY = Platform.select({ ios: "Menlo", android: "monospace" });

const TokenSpan = React.memo(function TokenSpan({ token }: { token: HighlightToken }): JSX.Element {
  return (
    <Text style={{ color: ONE_DARK_COLORS[token.type], fontFamily: FONT_FAMILY, fontSize: 13 }}>
      {token.text}
    </Text>
  );
});

export const CodeBlock = React.memo(function CodeBlock({
  code,
  language,
  showLineNumbers = false,
  showCopyButton = true,
  maxLines,
  selectable = false,
}: CodeBlockProps): JSX.Element {
  const trimmedCode = code.endsWith("\n") ? code.slice(0, -1) : code;
  const lines = tokenize(trimmedCode, language ?? "");
  const displayLines = maxLines && lines.length > maxLines ? lines.slice(0, maxLines) : lines;
  const truncated = maxLines ? lines.length > maxLines : false;
  const gutterWidth = showLineNumbers ? Math.max(String(displayLines.length).length * 9 + 12, 32) : 0;

  const handleCopy = useCallback(() => {
    void Clipboard.setStringAsync(trimmedCode);
  }, [trimmedCode]);

  return (
    <View className="bg-[#1E1E1E] rounded-lg overflow-hidden">
      {(language || showCopyButton) && (
        <View className="flex-row items-center justify-between px-3 pt-2 pb-1">
          {language ? (
            <Text className="text-muted-foreground text-[11px] uppercase">{language}</Text>
          ) : <View />}
          {showCopyButton && (
            <Pressable
              onPress={handleCopy}
              className="px-2 py-1 rounded active:opacity-60"
              hitSlop={8}
            >
              <Text className="text-muted-foreground text-[11px]">Copy</Text>
            </Pressable>
          )}
        </View>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="px-3 pb-3 pt-1">
          {displayLines.map((lineTokens, lineIdx) => (
            <View key={lineIdx} style={{ flexDirection: "row", minHeight: 20 }}>
              {showLineNumbers && (
                <Text
                  style={{
                    width: gutterWidth,
                    color: "#4b5563",
                    fontFamily: FONT_FAMILY,
                    fontSize: 13,
                    textAlign: "right",
                    paddingRight: 12,
                  }}
                >
                  {lineIdx + 1}
                </Text>
              )}
              <Text style={{ flexShrink: 1 }} selectable={selectable}>
                {lineTokens.length === 0 ? (
                  <Text style={{ color: ONE_DARK_COLORS.plain, fontFamily: FONT_FAMILY, fontSize: 13 }}>{" "}</Text>
                ) : (
                  lineTokens.map((token, tokenIdx) => (
                    <TokenSpan key={tokenIdx} token={token} />
                  ))
                )}
              </Text>
            </View>
          ))}
          {truncated && (
            <Text style={{ color: "#5c6370", fontFamily: FONT_FAMILY, fontSize: 12, marginTop: 4 }}>
              ... {lines.length - displayLines.length} more lines
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
});
