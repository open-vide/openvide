import React, { useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { cn } from "../lib/utils";
import { describeCommandIntent } from "../core/ai/commandIntent";
import type { AiContentBlock } from "../core/types";
import { inferLanguageFromPath } from "../core/syntaxHighlight";
import {
  isEnterPlanModeToolName,
  isExitPlanModeToolName,
  isRequestUserInputToolName,
  isUpdatePlanToolName,
} from "../core/ai/planMode";
import { CommandExecutionCard } from "./CommandExecutionCard";
import { CodeBlock } from "./CodeBlock";
import { CollapsibleCard } from "./CollapsibleCard";
import { MonoBlock } from "./MonoBlock";
import { StreamingDots } from "./StreamingDots";
import { getDiffStats } from "./DiffView";
import { ToolActivityRow } from "./ToolActivityRow";

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

function summarizeStdin(chars: string): string {
  if (chars === "\n" || chars === "\r" || chars === "\r\n") {
    return "<enter>";
  }
  if (chars === "\t") {
    return "<tab>";
  }
  if (chars === "\u001b") {
    return "<esc>";
  }
  if (chars === "\u0003") {
    return "<ctrl+c>";
  }

  return chars
    .replace(/\r\n/g, "\n")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

function basename(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function buildSearchLabel(pattern: string, path: string): string {
  return path ? `Search ${pattern} in ${path}` : `Search ${pattern}`;
}

function buildListLabel(path: string): string {
  return path ? `List ${path}` : "List files";
}

function getStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function getQuestionKey(question: Record<string, unknown>, index: number): string {
  return getStringValue(question["id"]) ?? `question_${index + 1}`;
}

function buildUserInputResponse(
  questions: Array<Record<string, unknown>>,
  answers: Record<string, string>,
): string {
  if (questions.length === 0) {
    return "";
  }

  if (questions.length === 1) {
    const key = getQuestionKey(questions[0]!, 0);
    return answers[key] ?? "";
  }

  return questions
    .map((question, index) => {
      const key = getQuestionKey(question, index);
      const answer = answers[key] ?? "";
      return `${key}: ${answer}`;
    })
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

function PlanStepStatusPill({ status }: { status?: string }): JSX.Element {
  const normalized = (status ?? "").trim().toLowerCase();
  const label = normalized === "completed"
    ? "Done"
    : normalized === "in_progress"
      ? "In progress"
      : normalized === "pending"
        ? "Pending"
        : "Step";

  return (
    <View
      className={cn(
        "rounded-full px-2 py-1 border self-start",
        normalized === "completed" && "bg-[#163322] border-[#2E7D4F]",
        normalized === "in_progress" && "bg-[#332A18] border-[#8A6A2E]",
        normalized === "pending" && "bg-muted border-border",
        normalized !== "completed" && normalized !== "in_progress" && normalized !== "pending" && "bg-muted border-border",
      )}
      style={{ borderCurve: "continuous" }}
    >
      <Text className="text-foreground text-[11px] font-semibold">{label}</Text>
    </View>
  );
}

export function ToolUseCard({
  block,
  onSendResponse,
  showToolDetails = false,
}: {
  block: AiContentBlock;
  onSendResponse?: (text: string) => void;
  showToolDetails?: boolean;
}): JSX.Element | null {
  const navigation = useNavigation<any>();
  const toolName = block.toolName ?? "Tool";
  const input = block.toolInput as Record<string, unknown> | undefined;
  const isRunning = block.toolStatus === "running";

  if (isRequestUserInputToolName(toolName) && input) {
    return <RequestUserInputCard input={input} onSendResponse={onSendResponse} />;
  }

  if (isUpdatePlanToolName(toolName) && input) {
    return <UpdatePlanCard input={input} />;
  }

  const statusIndicator = <StatusIndicator status={block.toolStatus} />;

  if (toolName === "exec_command") {
    const command = (input?.["cmd"] as string) ?? (input?.["command"] as string) ?? "";
    const workdir = (input?.["workdir"] as string) ?? (input?.["cwd"] as string) ?? "";
    const intent = describeCommandIntent(command);

    if (intent.kind === "read" && intent.filePath) {
      return <ToolActivityRow icon="file-text" label={`Read ${basename(intent.filePath)}`} status={block.toolStatus} />;
    }
    if (intent.kind === "search" && intent.pattern) {
      return <ToolActivityRow icon="search" label={buildSearchLabel(intent.pattern, intent.path ?? "")} status={block.toolStatus} />;
    }
    if (intent.kind === "list") {
      return <ToolActivityRow icon="folder" label={buildListLabel(intent.path ?? "")} status={block.toolStatus} />;
    }

    if (command.length > 0) {
      return (
        <CommandExecutionCard
          title="Command"
          command={command}
          subtitle={workdir || undefined}
          status={block.toolStatus}
          activityText={block.activityText}
        />
      );
    }
  }

  if (toolName === "write_stdin") {
    const chars = typeof input?.["chars"] === "string" ? input["chars"] as string : "";
    if (chars.length === 0) {
      return null;
    }

    return (
      <CommandExecutionCard
        title="Input"
        command={summarizeStdin(chars)}
        codeLanguage=""
        status={block.toolStatus}
      />
    );
  }

  if (toolName === "Edit" || toolName === "MultiEdit") {
    const filePath = (input?.["file_path"] as string) ?? (input?.["filePath"] as string) ?? "";
    const oldStr = (input?.["old_string"] as string) ?? "";
    const newStr = (input?.["new_string"] as string) ?? "";
    const lang = filePath ? inferLanguageFromPath(filePath) : "";

    const buildEditDiff = (): string => {
      const oldLines = oldStr.split("\n");
      const newLines = newStr.split("\n");
      const lines: string[] = [];
      lines.push(`--- a/${filePath}`, `+++ b/${filePath}`, `@@ -1,${oldLines.length} +1,${newLines.length} @@`);
      for (const l of oldLines) lines.push(`-${l}`);
      for (const l of newLines) lines.push(`+${l}`);
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
          defaultOpen={showToolDetails || isRunning || (oldStr.length > 0 || newStr.length > 0)}
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
      const contentLines = content.split("\n");
      const lines: string[] = [`--- /dev/null`, `+++ b/${filePath}`, `@@ -0,0 +1,${contentLines.length} @@`];
      for (const l of contentLines) lines.push(`+${l}`);
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
          defaultOpen={showToolDetails || isRunning || content.length > 0}
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
    return <ToolActivityRow icon="file-text" label={`Read ${basename(filePath || "file")}`} status={block.toolStatus} />;
  }

  if (toolName === "Bash") {
    const command = (input?.["command"] as string) ?? "";
    return (
      <View className="gap-1">
        <View className="flex-row items-center gap-1.5 px-1">
          <Text className="text-dimmed text-xs font-semibold">Bash</Text>
          {statusIndicator}
        </View>
        <CodeBlock code={command || JSON.stringify(input, null, 2)} language="bash" showCopyButton />
        {block.activityText && isRunning && (
          <Text className="text-dimmed text-xs mt-0.5 ml-1">{block.activityText}</Text>
        )}
      </View>
    );
  }

  if (toolName === "Grep" || toolName === "Glob") {
    const pattern = (input?.["pattern"] as string) ?? "";
    const path = (input?.["path"] as string) ?? "";
    const label = toolName === "Glob" ? buildListLabel(path) : buildSearchLabel(pattern, path);
    return <ToolActivityRow icon={toolName === "Glob" ? "folder" : "search"} label={label} status={block.toolStatus} />;
  }

  // ── Plan mode tools ──
  if (isExitPlanModeToolName(toolName)) {
    const prompts = input?.["allowedPrompts"] as Array<Record<string, unknown>> | undefined;
    const promptSummary = prompts?.map((p) => typeof p["prompt"] === "string" ? p["prompt"] : "").filter(Boolean);
    return (
      <View className="flex-row items-center gap-1.5 px-1 py-1">
        <Text className="text-muted-foreground text-xs font-semibold">Plan ready for approval</Text>
        {statusIndicator}
        {promptSummary && promptSummary.length > 0 && (
          <Text className="text-muted-foreground text-[11px]" numberOfLines={1}>
            ({promptSummary.length} permitted actions)
          </Text>
        )}
      </View>
    );
  }

  if (isEnterPlanModeToolName(toolName)) {
    return (
      <View className="flex-row items-center gap-1.5 px-1 py-1">
        <Text className="text-muted-foreground text-xs font-semibold">Entering plan mode</Text>
        {statusIndicator}
      </View>
    );
  }

  // ── Task / agent tools — compact one-liner ──
  if (toolName === "Task") {
    const description = (input?.["description"] as string) ?? "";
    return (
      <View className="flex-row items-center gap-1.5 px-1 py-1">
        <Text className="text-muted-foreground text-xs font-semibold">Agent: {description || "subtask"}</Text>
        {statusIndicator}
      </View>
    );
  }

  if (toolName === "TodoWrite" || toolName === "TaskCreate" || toolName === "TaskUpdate" || toolName === "TaskList" || toolName === "TaskGet") {
    const subject = (input?.["subject"] as string) ?? "";
    const status = (input?.["status"] as string) ?? "";
    const label = subject ? `${toolName}: ${subject}` : (status ? `${toolName} (${status})` : toolName);
    return (
      <View className="flex-row items-center gap-1.5 px-1 py-1">
        <Text className="text-muted-foreground text-xs font-semibold" numberOfLines={1}>{label}</Text>
        {statusIndicator}
      </View>
    );
  }

  // ── Web tools ──
  if (toolName === "WebSearch") {
    const query = (input?.["query"] as string) ?? "";
    return (
      <View className="flex-row items-center gap-1.5 px-1 py-1">
        <Text className="text-muted-foreground text-xs font-semibold">Search: {query || "web"}</Text>
        {statusIndicator}
      </View>
    );
  }

  if (toolName === "WebFetch") {
    const url = (input?.["url"] as string) ?? "";
    const host = url ? (() => { try { return new URL(url).hostname; } catch { return url.slice(0, 40); } })() : "";
    return (
      <View className="flex-row items-center gap-1.5 px-1 py-1">
        <Text className="text-muted-foreground text-xs font-semibold">Fetch: {host || "url"}</Text>
        {statusIndicator}
      </View>
    );
  }

  // ── Skill invocation ──
  if (toolName === "Skill") {
    const skill = (input?.["skill"] as string) ?? "";
    return (
      <View className="flex-row items-center gap-1.5 px-1 py-1">
        <Text className="text-muted-foreground text-xs font-semibold">Skill: /{skill || "unknown"}</Text>
        {statusIndicator}
      </View>
    );
  }

  // ── Generic fallback — collapsed by default to avoid wall of JSON ──
  return (
    <View>
      <CollapsibleCard
        title={toolName}
        defaultOpen={showToolDetails || isRunning}
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

function UpdatePlanCard({
  input,
}: {
  input: Record<string, unknown>;
}): JSX.Element {
  const explanation = getStringValue(input["explanation"]);
  const plan = Array.isArray(input["plan"])
    ? input["plan"].filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
    : [];

  return (
    <View className="bg-card rounded-xl border border-border p-3.5 gap-3">
      <View className="gap-1">
        <Text className="text-foreground text-[15px] leading-[22px] font-semibold">
          Plan updated
        </Text>
        {explanation ? (
          <Text selectable className="text-muted-foreground text-[13px] leading-[19px]">
            {explanation}
          </Text>
        ) : null}
      </View>
      {plan.length > 0 ? (
        <View className="gap-2.5">
          {plan.map((item, index) => {
            const step = getStringValue(item["step"]) ?? `Step ${index + 1}`;
            const status = getStringValue(item["status"]);
            return (
              <View
                key={`${index}-${step}`}
                className="rounded-[14px] border border-border bg-muted px-3 py-3 gap-2"
                style={{ borderCurve: "continuous" }}
              >
                <View className="flex-row items-start justify-between gap-3">
                  <Text selectable className="text-foreground text-[14px] leading-[20px] flex-1">
                    {index + 1}. {step}
                  </Text>
                  <PlanStepStatusPill status={status} />
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <Text selectable className="text-muted-foreground text-[13px] leading-[19px]">
          No structured steps were included in this update.
        </Text>
      )}
    </View>
  );
}

function RequestUserInputCard({
  input,
  onSendResponse,
}: {
  input: Record<string, unknown>;
  onSendResponse?: (text: string) => void;
}): JSX.Element {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const questions = Array.isArray(input["questions"])
    ? input["questions"].filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
    : [];

  const handleSelect = (question: Record<string, unknown>, index: number, label: string): void => {
    if (submitted) return;
    const key = getQuestionKey(question, index);
    const nextAnswers = { ...answers, [key]: label };
    setAnswers(nextAnswers);

    if (Object.keys(nextAnswers).length < questions.length) {
      return;
    }

    const response = buildUserInputResponse(questions, nextAnswers);
    setSubmitted(true);
    if (response.trim().length > 0) {
      onSendResponse?.(response);
    }
  };

  const selectedCount = Object.keys(answers).length;
  const remainingCount = Math.max(questions.length - selectedCount, 0);

  return (
    <View className="bg-card rounded-xl border border-border p-3.5 gap-3">
      <View className="gap-1">
        <Text className="text-foreground text-[15px] leading-[22px] font-semibold">
          Need your input
        </Text>
        <Text selectable className="text-muted-foreground text-[13px] leading-[19px]">
          Choose an option below. You can also type a custom reply in the input bar.
        </Text>
      </View>
      {questions.length === 0 ? (
        <Text selectable className="text-muted-foreground text-[13px] leading-[19px]">
          No structured options were included. Reply in the input bar.
        </Text>
      ) : null}
      {questions.map((question, questionIndex) => {
        const header = getStringValue(question["header"]);
        const questionText = getStringValue(question["question"]) ?? "Choose an option:";
        const questionKey = getQuestionKey(question, questionIndex);
        const options = Array.isArray(question["options"])
          ? question["options"].filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
          : [];
        const selectedLabel = answers[questionKey];

        return (
          <View
            key={questionKey}
            className="rounded-[14px] border border-border bg-muted px-3 py-3 gap-3"
            style={{ borderCurve: "continuous" }}
          >
            <View className="gap-1.5">
              {header ? (
                <Text className="text-dimmed text-[11px] uppercase tracking-[0.6px] font-semibold">
                  {header}
                </Text>
              ) : null}
              <Text className="text-foreground text-[14px] leading-[20px] font-semibold">
                {questionText}
              </Text>
            </View>
            <View className="gap-2">
              {options.map((opt, optionIndex) => {
                const label = getStringValue(opt["label"]) ?? `Option ${optionIndex + 1}`;
                const description = getStringValue(opt["description"]);
                const isSelected = selectedLabel === label;
                return (
                  <Pressable
                    key={`${questionKey}-${label}`}
                    className={cn(
                      "rounded-[12px] border px-3.5 py-3 gap-1.5",
                      isSelected ? "bg-muted border-accent" : "bg-card border-border",
                      submitted && "opacity-60",
                      !submitted && !isSelected && "active:bg-muted",
                    )}
                    style={{ borderCurve: "continuous" }}
                    onPress={() => handleSelect(question, questionIndex, label)}
                    disabled={submitted}
                  >
                    <Text className="text-foreground text-sm font-semibold">{label}</Text>
                    {description ? (
                      <Text className="text-muted-foreground text-xs leading-[17px]">
                        {description}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}
      {submitted ? (
        <Text className="text-dimmed text-xs italic">Response sent</Text>
      ) : remainingCount > 0 ? (
        <Text className="text-dimmed text-xs italic">
          {remainingCount === 1 ? "Select 1 more answer" : `Select ${remainingCount} more answers`}
        </Text>
      ) : null}
    </View>
  );
}
