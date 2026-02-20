import type { ToolName } from "./types";

export interface ModelOption {
  id: string;
  label: string;
  tool: ToolName;
}

export const MODEL_OPTIONS: ModelOption[] = [
  // Claude Code CLI (--model flag, short aliases)
  { id: "opus", label: "Opus 4.6", tool: "claude" },
  { id: "sonnet", label: "Sonnet 4.6", tool: "claude" },
  { id: "haiku", label: "Haiku 4.5", tool: "claude" },

  // Codex CLI (OPENAI_MODEL env var / -m flag)
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", tool: "codex" },
  { id: "gpt-5.2-codex", label: "GPT-5.2 Codex", tool: "codex" },
  { id: "gpt-5.1-codex-max", label: "GPT-5.1 Codex Max", tool: "codex" },
  { id: "gpt-5.2", label: "GPT-5.2", tool: "codex" },
  { id: "gpt-5.1-codex-mini", label: "GPT-5.1 Codex Mini", tool: "codex" },

  // Gemini CLI (--model flag)
  { id: "gemini-2.5-pro", label: "2.5 Pro", tool: "gemini" },
  { id: "gemini-2.5-flash", label: "2.5 Flash", tool: "gemini" },
  { id: "gemini-2.0-flash", label: "2.0 Flash", tool: "gemini" },
];

const DEFAULT_MODELS: Record<ToolName, string> = {
  claude: "opus",
  codex: "gpt-5.3-codex",
  gemini: "gemini-2.5-flash",
};

export function getModelsForTool(tool: ToolName): ModelOption[] {
  return MODEL_OPTIONS.filter((m) => m.tool === tool);
}

export function getDefaultModel(tool: ToolName): string {
  return DEFAULT_MODELS[tool];
}

const CONTEXT_WINDOWS: Record<string, number> = {
  opus: 200000,
  sonnet: 200000,
  haiku: 200000,
  "gpt-5.3-codex": 258400,
  "gpt-5.2-codex": 258400,
  "gpt-5.1-codex-max": 258400,
  "gpt-5.2": 258400,
  "gpt-5.1-codex-mini": 258400,
  "gemini-2.5-pro": 1000000,
  "gemini-2.5-flash": 1000000,
  "gemini-2.0-flash": 1000000,
};

export function getContextWindow(modelId: string): number {
  return CONTEXT_WINDOWS[modelId] ?? 200000;
}
