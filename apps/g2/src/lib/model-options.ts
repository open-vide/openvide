import type { ModelInfo } from '../types';

export interface ToolModelOption {
  value: string;
  label: string;
}

const CLAUDE_MODELS: ToolModelOption[] = [
  { value: 'opus', label: 'Opus 4.6' },
  { value: 'sonnet', label: 'Sonnet 4.6' },
  { value: 'haiku', label: 'Haiku 4.5' },
];

const GEMINI_MODELS: ToolModelOption[] = [
  { value: 'gemini-2.5-pro', label: '2.5 Pro' },
  { value: 'gemini-2.5-flash', label: '2.5 Flash' },
];

export function getToolModelOptions(tool: string, codexModels?: ModelInfo[]): ToolModelOption[] {
  if (tool === 'claude') {
    return CLAUDE_MODELS;
  }

  if (tool === 'gemini') {
    return GEMINI_MODELS;
  }

  return (codexModels ?? [])
    .filter((model) => !model.hidden)
    .map((model) => ({ value: model.id, label: model.displayName }));
}
