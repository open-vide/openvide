import React from "react";
import { Text, View } from "react-native";
import { useThemeColors } from "../constants/colors";
import { GlassContainer } from "./GlassContainer";
import { CodeBlock } from "./CodeBlock";
import { Icon } from "./Icon";
import { MonoBlock } from "./MonoBlock";
import { StreamingDots } from "./StreamingDots";
import { TruncatedText } from "./TruncatedText";

type CommandCardStatus = "running" | "completed" | "error";

function buildStatusAppearance(
  status: CommandCardStatus | undefined,
  colors: ReturnType<typeof useThemeColors>,
): { label: string; textColor: string; backgroundColor: string; icon?: React.ReactNode } | null {
  if (status === "running") {
    return {
      label: "Running",
      textColor: colors.accent,
      backgroundColor: `${colors.accent}22`,
      icon: <StreamingDots />,
    };
  }
  if (status === "error") {
    return {
      label: "Failed",
      textColor: colors.destructive,
      backgroundColor: `${colors.destructive}20`,
    };
  }
  if (status === "completed") {
    return {
      label: "Done",
      textColor: colors.success,
      backgroundColor: `${colors.success}20`,
    };
  }
  return null;
}

export function CommandExecutionCard({
  title,
  command,
  subtitle,
  status,
  codeLanguage = "bash",
  output,
  outputLabel = "Output",
  exitCode,
  activityText,
}: {
  title: string;
  command: string;
  subtitle?: string;
  status?: CommandCardStatus;
  codeLanguage?: string;
  output?: string;
  outputLabel?: string;
  exitCode?: number;
  activityText?: string;
}): JSX.Element {
  const colors = useThemeColors();
  const statusAppearance = buildStatusAppearance(status, colors);

  return (
    <GlassContainer variant="card" className="overflow-hidden">
      <View className="px-3.5 pt-3.5 pb-3 gap-3">
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-row items-center gap-2 shrink">
            <View
              className="w-7 h-7 rounded-full items-center justify-center"
              style={{ backgroundColor: `${colors.accent}18` }}
            >
              <Icon name="terminal" size={14} color={colors.accent} />
            </View>
            <View className="shrink">
              <Text selectable className="text-foreground text-[15px] font-semibold">
                {title}
              </Text>
              {subtitle ? (
                <Text selectable className="text-muted-foreground text-[11px] font-mono mt-0.5">
                  {subtitle}
                </Text>
              ) : null}
            </View>
          </View>
          {statusAppearance ? (
            <View
              className="flex-row items-center gap-1.5 rounded-full px-2.5 py-1"
              style={{ backgroundColor: statusAppearance.backgroundColor }}
            >
              {statusAppearance.icon}
              <Text
                selectable
                className="text-[11px] font-semibold"
                style={{ color: statusAppearance.textColor }}
              >
                {statusAppearance.label}
              </Text>
            </View>
          ) : null}
        </View>

        <CodeBlock code={command} language={codeLanguage || undefined} showCopyButton />

        {output ? (
          <View className="gap-1.5">
            <Text selectable className="text-muted-foreground text-[11px] uppercase" style={{ letterSpacing: 0.6 }}>
              {outputLabel}
            </Text>
            <TruncatedText text={output} maxLines={120}>
              {(visibleText) => (
                <MonoBlock text={visibleText} copyable />
              )}
            </TruncatedText>
          </View>
        ) : null}

        {activityText && status === "running" ? (
          <Text selectable className="text-dimmed text-[12px]">
            {activityText}
          </Text>
        ) : null}

        {exitCode != null && exitCode !== 0 ? (
          <View className="self-start rounded-full px-2.5 py-1" style={{ backgroundColor: `${colors.destructive}20` }}>
            <Text selectable className="text-[11px] font-semibold font-mono" style={{ color: colors.destructive }}>
              exit {exitCode}
            </Text>
          </View>
        ) : null}
      </View>
    </GlassContainer>
  );
}
