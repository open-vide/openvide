import type { ToolName } from "../types";
import type { CliAdapter } from "./adapterTypes";
import { claudeAdapter } from "./adapters/claudeAdapter";
import { codexAdapter } from "./adapters/codexAdapter";
import { geminiAdapter } from "./adapters/geminiAdapter";

const registry: Record<ToolName, CliAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter,
};

export function getAdapter(tool: ToolName): CliAdapter {
  return registry[tool];
}
