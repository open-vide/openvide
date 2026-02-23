import type { ToolName } from "./types";
import type { FeatherIconName } from "../components/Icon";

export interface ModeOption {
  id: string;
  label: string;
  icon: FeatherIconName;
  tool: ToolName;
}

export const MODE_OPTIONS: ModeOption[] = [
  // Claude Code modes
  { id: "code", label: "Code", icon: "code", tool: "claude" },
  { id: "plan", label: "Plan", icon: "book-open", tool: "claude" },
  { id: "chat", label: "Chat", icon: "message-circle", tool: "claude" },

  // Codex modes
  { id: "auto", label: "Auto", icon: "zap", tool: "codex" },
  { id: "plan", label: "Plan", icon: "book-open", tool: "codex" },
];

const DEFAULT_MODES: Partial<Record<ToolName, string>> = {
  claude: "code",
  codex: "auto",
};

export function getModesForTool(tool: ToolName): ModeOption[] {
  return MODE_OPTIONS.filter((m) => m.tool === tool);
}

export function getDefaultMode(tool: ToolName): string | undefined {
  return DEFAULT_MODES[tool];
}

export function getNextMode(tool: ToolName, current: string | undefined): string | undefined {
  const modes = getModesForTool(tool);
  if (modes.length === 0) return undefined;
  const idx = modes.findIndex((m) => m.id === current);
  const next = (idx + 1) % modes.length;
  return modes[next]!.id;
}
