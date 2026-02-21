import React, { useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { cn } from "../lib/utils";
import type { AiContentBlock } from "../core/types";
import { inferLanguageFromPath } from "../core/syntaxHighlight";
import { CodeBlock } from "./CodeBlock";
import { CollapsibleCard } from "./CollapsibleCard";
import { MonoBlock } from "./MonoBlock";
import { StreamingDots } from "./StreamingDots";
import { getDiffStats } from "./DiffView";

const FONT_FAMILY = Platform.select({ ios: "Menlo", android: "monospace" });

function StatusIndicator({ status }: { status?: AiContentBlock["toolStatus"] }): JSX.Element | null {
  if (status === "running") {
    return <StreamingDots />;
  }
  if (status === "completed") {
    return <Text className="text-success text-xs font-semibold">{"\u2713"}</Text>;
  }
  if (status === "error") {
    return <Text className="text-destructive text-xs font-semibold">{"\u2717"}</Text>;
  }
  return null;
}

function InlineDiff({ oldStr, newStr }: { oldStr: string; newStr: string }): JSX.Element {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ paddingBottom: 4 }}>
        {oldStr.split("\n").map((line, i) => (
          <View key={`old-${i}`} style={{ flexDirection: "row", backgroundColor: "rgba(220, 38, 38, 0.1)", minHeight: 20 }}>
            <Text style={{ width: 20, color: "#f87171", fontFamily: FONT_FAMILY, fontSize: 12, textAlign: "center" }}>-</Text>
            <Text style={{ fontFamily: FONT_FAMILY, fontSize: 12, color: "#f87171", flexShrink: 1 }}>{line}</Text>
          </View>
        ))}
        {newStr.split("\n").map((line, i) => (
          <View key={`new-${i}`} style={{ flexDirection: "row", backgroundColor: "rgba(22, 163, 74, 0.1)", minHeight: 20 }}>
            <Text style={{ width: 20, color: "#4ade80", fontFamily: FONT_FAMILY, fontSize: 12, textAlign: "center" }}>+</Text>
            <Text style={{ fontFamily: FONT_FAMILY, fontSize: 12, color: "#4ade80", flexShrink: 1 }}>{line}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export function ToolUseCard({
  block,
  onSendResponse,
}: {
  block: AiContentBlock;
  onSendResponse?: (text: string) => void;
}): JSX.Element {
  const navigation = useNavigation<any>();
  const toolName = block.toolName ?? "Tool";
  const input = block.toolInput as Record<string, unknown> | undefined;
  const isRunning = block.toolStatus === "running";
  const isCompleted = block.toolStatus === "completed" || block.toolStatus === "error";

  if (toolName === "AskUserQuestion" && input) {
    return <AskUserQuestionCard input={input} onSendResponse={onSendResponse} />;
  }

  const statusIndicator = <StatusIndicator status={block.toolStatus} />;

  if (toolName === "Edit" || toolName === "MultiEdit") {
    const filePath = (input?.["file_path"] as string) ?? (input?.["filePath"] as string) ?? "";
    const oldStr = (input?.["old_string"] as string) ?? "";
    const newStr = (input?.["new_string"] as string) ?? "";
    const lang = filePath ? inferLanguageFromPath(filePath) : "";

    const buildEditDiff = (): string => {
      const lines: string[] = [];
      lines.push(`--- a/${filePath}`, `+++ b/${filePath}`, "@@ edit @@");
      for (const l of oldStr.split("\n")) lines.push(`-${l}`);
      for (const l of newStr.split("\n")) lines.push(`+${l}`);
      return lines.join("\n");
    };

    const diffText = buildEditDiff();
    const stats = (oldStr.length > 0 || newStr.length > 0) ? getDiffStats(diffText) : null;
    const totalPreviewLines = oldStr.split("\n").length + newStr.split("\n").length;
    const showPreviewLimit = totalPreviewLines > 10;

    return (
      <Pressable
        onPress={() => {
          if (oldStr.length > 0 || newStr.length > 0) {
            navigation.navigate("DiffViewer", { diff: diffText, filePath, language: lang || undefined });
          }
        }}
      >
        <CollapsibleCard
          title={`${toolName}: ${filePath || "file"}`}
          defaultOpen={isRunning || (oldStr.length > 0 || newStr.length > 0)}
          titleRight={statusIndicator}
        >
          {stats && (
            <Text className="text-muted-foreground text-[11px] mb-1">
              {stats.removed > 0 ? `${stats.removed} removed` : ""}{stats.removed > 0 && stats.added > 0 ? ", " : ""}{stats.added > 0 ? `${stats.added} added` : ""}
            </Text>
          )}
          {oldStr.length > 0 || newStr.length > 0 ? (
            <View className="bg-[#1E1E1E] rounded-lg overflow-hidden">
              {lang ? (
                <Text className="text-muted-foreground text-[11px] uppercase px-3 pt-2">{lang}</Text>
              ) : null}
              <InlineDiff
                oldStr={showPreviewLimit ? oldStr.split("\n").slice(0, 5).join("\n") : oldStr}
                newStr={showPreviewLimit ? newStr.split("\n").slice(0, 5).join("\n") : newStr}
              />
              {showPreviewLimit && (
                <View className="px-3 py-2 items-center border-t border-muted">
                  <Text className="text-accent text-xs font-semibold">View Full Diff</Text>
                </View>
              )}
            </View>
          ) : (
            <MonoBlock text={JSON.stringify(input, null, 2)} />
          )}
        </CollapsibleCard>
        {block.activityText && isRunning && (
          <Text className="text-dimmed text-xs mt-1 ml-1">{block.activityText}</Text>
        )}
      </Pressable>
    );
  }

  if (toolName === "Write") {
    const filePath = (input?.["file_path"] as string) ?? (input?.["filePath"] as string) ?? "";
    const content = (input?.["content"] as string) ?? "";
    const lang = filePath ? inferLanguageFromPath(filePath) : "";
    const contentLines = content.length > 0 ? content.split("\n").length : 0;

    const buildWriteDiff = (): string => {
      const lines: string[] = [`--- /dev/null`, `+++ b/${filePath}`, "@@ new file @@"];
      for (const l of content.split("\n")) lines.push(`+${l}`);
      return lines.join("\n");
    };

    return (
      <Pressable
        onPress={() => {
          if (content.length > 0) {
            navigation.navigate("DiffViewer", { diff: buildWriteDiff(), filePath, language: lang || undefined });
          }
        }}
      >
        <CollapsibleCard
          title={`Write: ${filePath || "file"}`}
          defaultOpen={isRunning || content.length > 0}
          titleRight={statusIndicator}
        >
          {contentLines > 0 && (
            <Text className="text-muted-foreground text-[11px] mb-1">
              {contentLines} lines added
            </Text>
          )}
          {content.length > 0 ? (
            <>
              <CodeBlock code={content} language={lang || undefined} showCopyButton maxLines={10} />
              {contentLines > 10 && (
                <View className="items-center py-1.5">
                  <Text className="text-accent text-xs font-semibold">View Full Diff</Text>
                </View>
              )}
            </>
          ) : (
            <MonoBlock text={JSON.stringify(input, null, 2)} />
          )}
        </CollapsibleCard>
        {block.activityText && isRunning && (
          <Text className="text-dimmed text-xs mt-1 ml-1">{block.activityText}</Text>
        )}
      </Pressable>
    );
  }

  if (toolName === "Read") {
    const filePath = (input?.["file_path"] as string) ?? (input?.["filePath"] as string) ?? "";
    return (
      <View>
        <CollapsibleCard
          title={`Read: ${filePath || "file"}`}
          defaultOpen={false}
          titleRight={statusIndicator}
        >
          <Text style={{ fontFamily: FONT_FAMILY, fontSize: 12, color: "#8E8E93" }}>{filePath}</Text>
        </CollapsibleCard>
        {block.activityText && isRunning && (
          <Text className="text-dimmed text-xs mt-1 ml-1">{block.activityText}</Text>
        )}
      </View>
    );
  }

  if (toolName === "Bash") {
    const command = (input?.["command"] as string) ?? "";
    return (
      <View>
        <CollapsibleCard
          title="Bash"
          defaultOpen={isRunning || !isCompleted}
          titleRight={statusIndicator}
        >
          <MonoBlock text={command || JSON.stringify(input, null, 2)} language="bash" />
        </CollapsibleCard>
        {block.activityText && isRunning && (
          <Text className="text-dimmed text-xs mt-1 ml-1">{block.activityText}</Text>
        )}
      </View>
    );
  }

  if (toolName === "Grep" || toolName === "Glob") {
    const pattern = (input?.["pattern"] as string) ?? "";
    const path = (input?.["path"] as string) ?? "";
    const title = path ? `${toolName}: ${pattern} in ${path}` : `${toolName}: ${pattern}`;
    return (
      <View>
        <CollapsibleCard
          title={title}
          defaultOpen={false}
          titleRight={statusIndicator}
        >
          <MonoBlock text={JSON.stringify(input, null, 2)} />
        </CollapsibleCard>
        {block.activityText && isRunning && (
          <Text className="text-dimmed text-xs mt-1 ml-1">{block.activityText}</Text>
        )}
      </View>
    );
  }

  return (
    <View>
      <CollapsibleCard
        title={toolName}
        defaultOpen={isRunning || !isCompleted}
        titleRight={statusIndicator}
      >
        <MonoBlock text={JSON.stringify(input, null, 2)} />
      </CollapsibleCard>
      {block.activityText && isRunning && (
        <Text className="text-dimmed text-xs mt-1 ml-1">{block.activityText}</Text>
      )}
    </View>
  );
}

function AskUserQuestionCard({
  input,
  onSendResponse,
}: {
  input: Record<string, unknown>;
  onSendResponse?: (text: string) => void;
}): JSX.Element {
  const [answered, setAnswered] = useState(false);

  const questions = input["questions"] as Array<Record<string, unknown>> | undefined;
  const firstQuestion = questions?.[0];
  const questionText = (firstQuestion?.["question"] as string) ?? "Choose an option:";
  const options = (firstQuestion?.["options"] as Array<Record<string, unknown>>) ?? [];

  const handleSelect = (label: string): void => {
    if (answered) return;
    setAnswered(true);
    onSendResponse?.(label);
  };

  return (
    <View className="bg-card rounded-xl border border-border p-3.5 gap-3">
      <Text className="text-foreground text-[15px] leading-[22px] font-semibold">
        {questionText}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {options.map((opt, i) => {
          const label = (opt["label"] as string) ?? `Option ${i + 1}`;
          const description = opt["description"] as string | undefined;
          return (
            <Pressable
              key={i}
              className={cn(
                "bg-muted rounded-[10px] border border-primary px-3.5 py-2.5 min-w-[80px]",
                answered && "opacity-50",
                !answered && "active:bg-pressed-primary",
              )}
              onPress={() => handleSelect(label)}
              disabled={answered}
            >
              <Text className="text-foreground text-sm font-semibold">{label}</Text>
              {description != null && (
                <Text className="text-muted-foreground text-xs mt-0.5" numberOfLines={2}>
                  {description}
                </Text>
              )}
            </Pressable>
          );
        })}
        <Pressable
          className={cn(
            "bg-muted rounded-[10px] border border-neutral px-3.5 py-2.5 min-w-[80px]",
            answered && "opacity-50",
            !answered && "active:bg-pressed-primary",
          )}
          onPress={() => handleSelect("Other")}
          disabled={answered}
        >
          <Text className="text-foreground text-sm font-semibold">Other...</Text>
        </Pressable>
      </View>
      {answered && <Text className="text-dimmed text-xs italic">Response sent</Text>}
    </View>
  );
}
