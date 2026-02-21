import type { AiContentBlock, AiMessage, ToolName } from "../types";

export interface CliStreamEvent {
  type:
    | "message_start"
    | "content_block"
    | "message_complete"
    | "error"
    | "usage";
  role?: "assistant" | "system";
  block?: AiContentBlock;
  conversationId?: string;
  inputTokens?: number;
  outputTokens?: number;
  contextUsedTokens?: number;
  contextWindowTokens?: number;
  contextSource?: "provider" | "derived";
}

export interface CliAdapter {
  tool: ToolName;
  readonly streaming: boolean;
  buildCommand(input: {
    prompt: string;
    workingDirectory?: string;
    conversationId?: string;
    allowedTools?: string[];
    messages?: AiMessage[];
    model?: string;
  }): string;
  createParseContext?(): Record<string, unknown>;
  parseLine(jsonLine: string, context?: Record<string, unknown>): CliStreamEvent[];
  parseComplete(jsonBlob: string, context?: Record<string, unknown>): CliStreamEvent[];
}
