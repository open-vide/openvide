import React, { useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { parseDiff, type DiffLine } from "../core/diffParser";
import { MonoBlock } from "./MonoBlock";

interface DiffViewProps {
  diff: string;
  filePath?: string;
  language?: string;
  mode?: "unified" | "split";
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

interface SplitRow {
  oldLine?: DiffLine;
  newLine?: DiffLine;
}

function buildSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.type === "hunk_header") {
      rows.push({ oldLine: line, newLine: line });
      i++;
      continue;
    }

    if (line.type === "context") {
      rows.push({ oldLine: line, newLine: line });
      i++;
      continue;
    }

    // Collect consecutive removes then adds and pair them
    const removes: DiffLine[] = [];
    const adds: DiffLine[] = [];

    while (i < lines.length && lines[i]!.type === "remove") {
      removes.push(lines[i]!);
      i++;
    }
    while (i < lines.length && lines[i]!.type === "add") {
      adds.push(lines[i]!);
      i++;
    }

    const maxLen = Math.max(removes.length, adds.length);
    for (let j = 0; j < maxLen; j++) {
      rows.push({
        oldLine: j < removes.length ? removes[j] : undefined,
        newLine: j < adds.length ? adds[j] : undefined,
      });
    }
  }
  return rows;
}

const SplitDiffRow = React.memo(function SplitDiffRow({ row }: { row: SplitRow }): JSX.Element {
  if (row.oldLine?.type === "hunk_header") {
    return (
      <View style={{ backgroundColor: "#2D2D2D", paddingHorizontal: 8, paddingVertical: 4 }}>
        <Text style={{ fontFamily: FONT_FAMILY, fontSize: 12, color: "#8E8E93" }}>
          {row.oldLine.text}
        </Text>
      </View>
    );
  }

  const oldBg = row.oldLine?.type === "remove" ? "rgba(220, 38, 38, 0.1)" : "transparent";
  const newBg = row.newLine?.type === "add" ? "rgba(22, 163, 74, 0.1)" : "transparent";
  const oldColor = row.oldLine?.type === "remove" ? "#f87171" : "#94a3b8";
  const newColor = row.newLine?.type === "add" ? "#4ade80" : "#94a3b8";

  return (
    <View style={{ flexDirection: "row", minHeight: 20 }}>
      {/* Old side */}
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: oldBg, borderRightWidth: 1, borderRightColor: "#333" }}>
        <Text style={{ width: 32, textAlign: "right", paddingRight: 4, fontFamily: FONT_FAMILY, fontSize: 12, color: "#4b5563" }}>
          {row.oldLine?.oldLineNum ?? ""}
        </Text>
        <Text style={{ fontFamily: FONT_FAMILY, fontSize: 12, color: oldColor, flexShrink: 1 }} numberOfLines={1}>
          {row.oldLine?.text ?? ""}
        </Text>
      </View>
      {/* New side */}
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: newBg }}>
        <Text style={{ width: 32, textAlign: "right", paddingRight: 4, fontFamily: FONT_FAMILY, fontSize: 12, color: "#4b5563" }}>
          {row.newLine?.newLineNum ?? ""}
        </Text>
        <Text style={{ fontFamily: FONT_FAMILY, fontSize: 12, color: newColor, flexShrink: 1 }} numberOfLines={1}>
          {row.newLine?.text ?? ""}
        </Text>
      </View>
    </View>
  );
});

export const DiffView = React.memo(function DiffView({
  diff,
  filePath,
  mode = "unified",
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

  if (mode === "split") {
    const splitRows = buildSplitRows(displayLines);
    return (
      <View className="bg-[#1E1E1E] rounded-lg overflow-hidden">
        {filePath && (
          <View className="px-3 pt-2 pb-1">
            <Text style={{ fontFamily: FONT_FAMILY, fontSize: 12, color: "#94a3b8", fontWeight: "600" }}>
              {filePath}
            </Text>
          </View>
        )}
        <View className="pb-2">
          {splitRows.map((row, idx) => (
            <SplitDiffRow key={idx} row={row} />
          ))}
        </View>
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
  }

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

/** Computes line count summary for a diff string */
export function getDiffStats(diff: string): { added: number; removed: number } {
  const parsed = parseDiff(diff);
  let added = 0;
  let removed = 0;
  for (const file of parsed) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type === "add") added++;
        if (line.type === "remove") removed++;
      }
    }
  }
  return { added, removed };
}
