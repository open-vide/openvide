import React, { useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { parseDiff, type DiffLine } from "../core/diffParser";
import { MonoBlock } from "./MonoBlock";

interface DiffViewProps {
  diff: string;
  filePath?: string;
  language?: string;
}

const FONT_FAMILY = Platform.select({ ios: "Menlo", android: "monospace" });
const MAX_LINES = 200;

const DiffLineRow = React.memo(function DiffLineRow({ line }: { line: DiffLine }): JSX.Element {
  if (line.type === "hunk_header") {
    return (
      <View style={{ backgroundColor: "#2D2D2D", paddingHorizontal: 8, paddingVertical: 4 }}>
        <Text style={{ fontFamily: FONT_FAMILY, fontSize: 12, color: "#8E8E93" }}>
          {line.text}
        </Text>
      </View>
    );
  }

  const bgColor =
    line.type === "add"
      ? "rgba(22, 163, 74, 0.1)"
      : line.type === "remove"
        ? "rgba(220, 38, 38, 0.1)"
        : "transparent";

  const textColor =
    line.type === "add"
      ? "#4ade80"
      : line.type === "remove"
        ? "#f87171"
        : "#94a3b8";

  const prefix =
    line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";

  return (
    <View style={{ flexDirection: "row", backgroundColor: bgColor, minHeight: 20 }}>
      <Text
        style={{
          width: 40,
          textAlign: "right",
          paddingRight: 4,
          fontFamily: FONT_FAMILY,
          fontSize: 12,
          color: "#4b5563",
        }}
      >
        {line.oldLineNum ?? ""}
      </Text>
      <Text
        style={{
          width: 40,
          textAlign: "right",
          paddingRight: 8,
          fontFamily: FONT_FAMILY,
          fontSize: 12,
          color: "#4b5563",
        }}
      >
        {line.newLineNum ?? ""}
      </Text>
      <Text style={{ fontFamily: FONT_FAMILY, fontSize: 13, color: textColor, flexShrink: 1 }}>
        {prefix}{line.text}
      </Text>
    </View>
  );
});

export const DiffView = React.memo(function DiffView({
  diff,
  filePath,
}: DiffViewProps): JSX.Element {
  const [showAll, setShowAll] = useState(false);
  const parsed = parseDiff(diff);

  if (parsed.length === 0) {
    return <MonoBlock text={diff} />;
  }

  const allLines: DiffLine[] = [];
  for (const file of parsed) {
    for (const hunk of file.hunks) {
      allLines.push(...hunk.lines);
    }
  }

  const displayLines = !showAll && allLines.length > MAX_LINES
    ? allLines.slice(0, MAX_LINES)
    : allLines;
  const truncated = !showAll && allLines.length > MAX_LINES;

  return (
    <View className="bg-[#1E1E1E] rounded-lg overflow-hidden">
      {filePath && (
        <View className="px-3 pt-2 pb-1">
          <Text style={{ fontFamily: FONT_FAMILY, fontSize: 12, color: "#94a3b8", fontWeight: "600" }}>
            {filePath}
          </Text>
        </View>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="pb-2">
          {displayLines.map((line, idx) => (
            <DiffLineRow key={idx} line={line} />
          ))}
        </View>
      </ScrollView>
      {truncated && (
        <Pressable
          className="px-3 py-2 items-center border-t border-muted"
          onPress={() => setShowAll(true)}
        >
          <Text className="text-accent text-xs font-semibold">
            Show all ({allLines.length - MAX_LINES} more lines)
          </Text>
        </Pressable>
      )}
    </View>
  );
});
