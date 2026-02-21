import { newId } from "../id";
import type { AiContentBlock, AiMessage, AiTurn, ToolName } from "../types";
import type { SessionHistoryPayload } from "./DaemonTransport";
import { getAdapter } from "./adapterRegistry";
import type { CliStreamEvent } from "./adapterTypes";
import { getContextWindow, getDefaultModel } from "../modelOptions";

export interface ParsedHistory {
  messages: AiMessage[];
  turns: AiTurn[];
  totalInputTokens: number;
  totalOutputTokens: number;
  contextStatus: "ok" | "unavailable";
  contextUsedTokens?: number;
  contextWindowTokens?: number;
  contextPercentUsed?: number;
  contextSource?: "provider" | "derived";
  contextLabel?: string;
}

function toIsoFromEpoch(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return new Date().toISOString();
  return new Date(ms).toISOString();
}

function extractTextFromUnknown(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const typed = item as Record<string, unknown>;
      const text = typed.text;
      if (typeof text === "string" && text.trim().length > 0) {
        parts.push(text.trim());
      }
    }
    return parts.join("\n").trim();
  }
  return "";
}

function createEmpty(): ParsedHistory {
  return {
    messages: [],
    turns: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    contextStatus: "unavailable",
    contextLabel: "Context N/A",
  };
}

const MAX_NATIVE_TEXT_CHARS = 12000;

function clampText(text: string, maxChars = MAX_NATIVE_TEXT_CHARS): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n\n[truncated]";
}

function isCodexBootstrapPrompt(text: string): boolean {
  const lower = text.toLowerCase();
  if (lower.includes("<environment_context>")) return true;
  if (lower.includes("agents.md instructions for")) return true;
  if (lower.includes("<permissions instructions>")) return true;
  if (lower.includes("filesystem sandboxing defines")) return true;
  if (lower.includes("approved command prefixes")) return true;
  if (text.length > 4000 && lower.includes("## skills")) return true;
  return false;
}

function applyContextSnapshot(history: ParsedHistory, input: {
  usedTokens?: number;
  windowTokens?: number;
  source?: "provider" | "derived";
}): void {
  if (input.usedTokens == null || !Number.isFinite(input.usedTokens) || input.usedTokens < 0) {
    return;
  }
  history.contextStatus = "ok";
  history.contextUsedTokens = Math.floor(input.usedTokens);
  if (input.windowTokens != null && Number.isFinite(input.windowTokens) && input.windowTokens > 0) {
    history.contextWindowTokens = Math.floor(input.windowTokens);
    history.contextPercentUsed = Math.max(0, Math.min((history.contextUsedTokens / history.contextWindowTokens) * 100, 100));
  }
  history.contextSource = input.source ?? "derived";
  history.contextLabel = undefined;
}

function ensureAssistantMessage(history: ParsedHistory, turnIndex: number, timestamp?: string): AiMessage {
  const last = history.messages[history.messages.length - 1];
  if (last && last.role === "assistant" && last.turnIndex === turnIndex) {
    return last;
  }
  const msg: AiMessage = {
    id: newId("msg"),
    role: "assistant",
    content: [],
    timestamp: timestamp ?? new Date().toISOString(),
    turnIndex,
    isStreaming: false,
  };
  history.messages.push(msg);
  return msg;
}

function addUserTurn(history: ParsedHistory, prompt: string, timestamp: string): number {
  const turnIndex = history.turns.length;
  history.turns.push({
    index: turnIndex,
    userPrompt: prompt,
    startedAt: timestamp,
  });
  history.messages.push({
    id: newId("msg"),
    role: "user",
    content: [{ type: "text", text: prompt }],
    timestamp,
    turnIndex,
    isStreaming: false,
  });
  return turnIndex;
}

function addTurnWithoutUser(history: ParsedHistory, timestamp: string): number {
  const turnIndex = history.turns.length;
  history.turns.push({
    index: turnIndex,
    userPrompt: "",
    startedAt: timestamp,
  });
  return turnIndex;
}

function processCliEvent(history: ParsedHistory, event: CliStreamEvent, turnIndex: number, timestamp: string): void {
  if (event.type === "message_start") {
    ensureAssistantMessage(history, turnIndex, timestamp);
    return;
  }

  if (event.type === "content_block" && event.block) {
    const msg = ensureAssistantMessage(history, turnIndex, timestamp);
    msg.content.push(event.block);
    return;
  }

  if (event.type === "usage") {
    if (event.inputTokens == null && event.outputTokens == null) {
      applyContextSnapshot(history, {
        usedTokens: event.contextUsedTokens,
        windowTokens: event.contextWindowTokens,
        source: event.contextSource,
      });
      return;
    }
    const msg = ensureAssistantMessage(history, turnIndex, timestamp);
    msg.content.push({
      type: "usage",
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
    });
    history.totalInputTokens += event.inputTokens ?? 0;
    history.totalOutputTokens += event.outputTokens ?? 0;
    applyContextSnapshot(history, {
      usedTokens: event.contextUsedTokens ?? event.inputTokens,
      windowTokens: event.contextWindowTokens,
      source: event.contextSource,
    });
    return;
  }

  if (event.type === "error" && event.block) {
    const msg = ensureAssistantMessage(history, turnIndex, timestamp);
    msg.content.push(event.block);
    return;
  }

  if (event.type === "message_complete") {
    const msg = ensureAssistantMessage(history, turnIndex, timestamp);
    msg.isStreaming = false;
  }
}

function parseDaemonHistory(tool: ToolName, lines: string[]): ParsedHistory {
  const history = createEmpty();
  const adapter = getAdapter(tool);
  let parseContext = adapter.createParseContext?.() ?? {};
  let currentTurn = -1;
  let jsonBuffer = "";

  for (const raw of lines) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    const t = parsed.t;
    const ts = typeof parsed.ts === "number" ? toIsoFromEpoch(parsed.ts) : new Date().toISOString();

    if (t === "m" && parsed.event === "turn_start") {
      const prompt = typeof parsed.prompt === "string" ? parsed.prompt : "";
      currentTurn = addUserTurn(history, prompt, ts);
      parseContext = adapter.createParseContext?.() ?? {};
      jsonBuffer = "";
      continue;
    }
    if (currentTurn < 0) continue;

    if (t === "o") {
      const line = typeof parsed.line === "string" ? parsed.line : "";
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (adapter.streaming) {
        const events = adapter.parseLine(trimmed, parseContext);
        for (const event of events) {
          processCliEvent(history, event, currentTurn, ts);
        }
      } else {
        jsonBuffer += line + "\n";
      }
      continue;
    }

    if (t === "e") {
      // Ignore stderr — many CLIs log non-error info to stderr (Codex state db warnings, etc.)
      // Stderr is only shown when the turn fails, handled by the turn_end exit code check.
      continue;
    }

    if (t === "m" && parsed.event === "turn_end") {
      const turn = history.turns[currentTurn];
      if (turn) {
        turn.endedAt = ts;
        if (typeof parsed.exitCode === "number") {
          turn.exitCode = parsed.exitCode;
        }
      }
      if (!adapter.streaming && jsonBuffer.trim().length > 0) {
        const events = adapter.parseComplete(jsonBuffer, parseContext);
        for (const event of events) {
          processCliEvent(history, event, currentTurn, ts);
        }
      }
      const last = history.messages[history.messages.length - 1];
      if (last && last.role === "assistant" && last.turnIndex === currentTurn) {
        last.isStreaming = false;
      }
      jsonBuffer = "";
    }
  }

  return history;
}

function extractClaudeBlocks(message: Record<string, unknown>): AiContentBlock[] {
  const out: AiContentBlock[] = [];
  const content = message.content;
  if (!Array.isArray(content)) return out;
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const block = item as Record<string, unknown>;
    const type = typeof block.type === "string" ? block.type : "";
    if (type === "text") {
      out.push({ type: "text", text: typeof block.text === "string" ? block.text : "" });
    } else if (type === "thinking") {
      out.push({ type: "thinking", text: typeof block.thinking === "string" ? block.thinking : "" });
    } else if (type === "tool_use" || type === "server_tool_use") {
      out.push({
        type: "tool_use",
        toolName: typeof block.name === "string" ? block.name : "tool",
        toolId: typeof block.id === "string" ? block.id : undefined,
        toolInput: block.input,
      });
    } else if (type === "tool_result") {
      out.push({
        type: "tool_result",
        toolId: typeof block.tool_use_id === "string" ? block.tool_use_id : undefined,
        result: extractTextFromUnknown(block.content),
        isError: block.is_error === true,
      });
    }
  }
  return out;
}

function parseNativeClaude(lines: string[]): ParsedHistory {
  const history = createEmpty();
  const assistantById = new Map<string, AiMessage>();
  const seenAssistantBlocks = new Set<string>();
  let currentTurn = -1;

  for (const raw of lines) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    const ts = typeof parsed.timestamp === "string" ? parsed.timestamp : new Date().toISOString();
    const type = typeof parsed.type === "string" ? parsed.type : "";

    if (type === "user") {
      const message = parsed.message as Record<string, unknown> | undefined;
      const role = message && typeof message.role === "string" ? message.role : "";
      if (role !== "user") continue;
      const text = extractTextFromUnknown(message?.content);
      if (text.length === 0) continue;
      currentTurn = addUserTurn(history, text, ts);
      continue;
    }

    if (type !== "assistant") continue;
    if (currentTurn < 0) {
      currentTurn = addTurnWithoutUser(history, ts);
    }

    const message = parsed.message as Record<string, unknown> | undefined;
    if (!message) continue;
    const messageId = typeof message.id === "string"
      ? message.id
      : (typeof parsed.uuid === "string" ? parsed.uuid : newId("assistant"));

    let msg = assistantById.get(messageId);
    if (!msg) {
      msg = {
        id: newId("msg"),
        role: "assistant",
        content: [],
        timestamp: ts,
        turnIndex: currentTurn,
        isStreaming: false,
      };
      assistantById.set(messageId, msg);
      history.messages.push(msg);
    }

    const blocks = extractClaudeBlocks(message);
    for (const block of blocks) {
      const key = `${messageId}:${JSON.stringify(block)}`;
      if (seenAssistantBlocks.has(key)) continue;
      seenAssistantBlocks.add(key);
      msg.content.push(block);
    }

    const usage = message.usage as Record<string, unknown> | undefined;
    if (usage) {
      const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : undefined;
      const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : undefined;
      if (inputTokens != null || outputTokens != null) {
        msg.content.push({ type: "usage", inputTokens, outputTokens });
        history.totalInputTokens += inputTokens ?? 0;
        history.totalOutputTokens += outputTokens ?? 0;
        applyContextSnapshot(history, {
          usedTokens: inputTokens,
          source: "derived",
        });
      }
    }
  }

  return history;
}

function extractCodexTextBlocks(content: unknown, expectedType: "input_text" | "output_text"): string {
  if (!Array.isArray(content)) return "";
  const out: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const block = item as Record<string, unknown>;
    const type = typeof block.type === "string" ? block.type : "";
    const text = typeof block.text === "string" ? block.text : "";
    if (!text.trim()) continue;
    if (type === expectedType || type === "text") {
      out.push(text.trim());
    }
  }
  return clampText(out.join("\n"));
}

function parseMaybeJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

function parseNativeCodex(lines: string[]): ParsedHistory {
  const history = createEmpty();
  let currentTurn = -1;

  for (const raw of lines) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (parsed.type === "event_msg") {
      const payload = parsed.payload as Record<string, unknown> | undefined;
      if (!payload || payload.type !== "token_count") {
        continue;
      }
      const info = payload.info as Record<string, unknown> | undefined;
      const lastUsage = info?.last_token_usage as Record<string, unknown> | undefined;
      const usedTokens = typeof lastUsage?.input_tokens === "number"
        ? lastUsage.input_tokens
        : undefined;
      const windowTokens = typeof info?.model_context_window === "number"
        ? info.model_context_window
        : undefined;
      if (usedTokens != null) {
        applyContextSnapshot(history, {
          usedTokens,
          windowTokens,
          source: "derived",
        });
      }
      continue;
    }

    if (parsed.type !== "response_item") continue;
    const payload = parsed.payload as Record<string, unknown> | undefined;
    if (!payload) continue;

    const ts = typeof parsed.timestamp === "string" ? parsed.timestamp : new Date().toISOString();
    const payloadType = typeof payload.type === "string" ? payload.type : "";

    if (payloadType === "message") {
      const role = typeof payload.role === "string" ? payload.role : "";
      if (role === "user") {
        const text = extractCodexTextBlocks(payload.content, "input_text");
        if (text.length > 0) {
          if (isCodexBootstrapPrompt(text)) {
            continue;
          }
          currentTurn = addUserTurn(history, clampText(text), ts);
        }
        continue;
      }
      if (role === "assistant" && currentTurn >= 0) {
        const text = extractCodexTextBlocks(payload.content, "output_text");
        if (text.length > 0) {
          const msg = ensureAssistantMessage(history, currentTurn, ts);
          msg.content.push({ type: "text", text: clampText(text) });
        }
        continue;
      }
    }

    if (currentTurn < 0) continue;

    if (payloadType === "reasoning") {
      const summary = payload.summary;
      let text = "";
      if (Array.isArray(summary)) {
        text = summary
          .map((entry) => {
            if (!entry || typeof entry !== "object") return "";
            const typed = entry as Record<string, unknown>;
            return typeof typed.text === "string" ? typed.text : "";
          })
          .filter((part) => part.length > 0)
          .join("\n");
      }
      if (!text && typeof payload.text === "string") {
        text = payload.text;
      }
      if (text.trim().length > 0) {
        const msg = ensureAssistantMessage(history, currentTurn, ts);
        msg.content.push({ type: "thinking", text: clampText(text.trim()) });
      }
      continue;
    }

    if (payloadType === "function_call") {
      const toolName = typeof payload.name === "string" ? payload.name : "tool";
      const args = typeof payload.arguments === "string" ? payload.arguments : "";
      const msg = ensureAssistantMessage(history, currentTurn, ts);
      msg.content.push({
        type: "tool_use",
        toolName,
        toolId: typeof payload.call_id === "string" ? payload.call_id : undefined,
        toolInput: parseMaybeJson(args),
      });
      continue;
    }

    if (payloadType === "function_call_output") {
      const output = typeof payload.output === "string" ? payload.output : "";
      const msg = ensureAssistantMessage(history, currentTurn, ts);
      msg.content.push({
        type: "tool_result",
        toolId: typeof payload.call_id === "string" ? payload.call_id : undefined,
        result: clampText(output),
      });
    }
  }

  return history;
}

function trimAndReindex(history: ParsedHistory, messageLimit: number): ParsedHistory {
  if (history.messages.length <= messageLimit) return history;

  const sliced = history.messages.slice(-messageLimit);
  const oldOrder: number[] = [];
  for (const msg of sliced) {
    if (!oldOrder.includes(msg.turnIndex)) {
      oldOrder.push(msg.turnIndex);
    }
  }
  const remap = new Map<number, number>();
  oldOrder.forEach((oldIndex, idx) => remap.set(oldIndex, idx));

  const messages = sliced.map((msg) => ({
    ...msg,
    turnIndex: remap.get(msg.turnIndex) ?? 0,
  }));
  const turns: AiTurn[] = [];
  for (const oldIndex of oldOrder) {
    const original = history.turns.find((turn) => turn.index === oldIndex);
    turns.push({
      index: remap.get(oldIndex) ?? 0,
      userPrompt: original?.userPrompt ?? "",
      startedAt: original?.startedAt ?? new Date().toISOString(),
      endedAt: original?.endedAt,
      exitCode: original?.exitCode,
      error: original?.error,
    });
  }

  return {
    messages,
    turns,
    totalInputTokens: history.totalInputTokens,
    totalOutputTokens: history.totalOutputTokens,
    contextStatus: history.contextStatus,
    contextUsedTokens: history.contextUsedTokens,
    contextWindowTokens: history.contextWindowTokens,
    contextPercentUsed: history.contextPercentUsed,
    contextSource: history.contextSource,
    contextLabel: history.contextLabel,
  };
}

export function parseSessionHistory(
  tool: ToolName,
  history: SessionHistoryPayload,
  options: number | { messageLimit?: number; modelId?: string } = 200,
): ParsedHistory {
  if (tool !== "claude" && tool !== "codex" && tool !== "gemini") {
    return createEmpty();
  }

  let parsed: ParsedHistory;
  if (history.format === "daemon_output_jsonl") {
    parsed = parseDaemonHistory(tool, history.lines);
  } else if (history.format === "native_claude_jsonl") {
    parsed = parseNativeClaude(history.lines);
  } else if (history.format === "native_codex_jsonl") {
    parsed = parseNativeCodex(history.lines);
  } else {
    parsed = createEmpty();
  }

  const messageLimit = typeof options === "number"
    ? options
    : (options.messageLimit ?? 200);
  const modelId = typeof options === "number"
    ? undefined
    : options.modelId;

  const out = trimAndReindex(parsed, Math.max(1, messageLimit));
  const resolvedModel = modelId ?? getDefaultModel(tool);
  const fallbackWindow = getContextWindow(resolvedModel);
  if (out.contextStatus === "ok" && out.contextUsedTokens != null) {
    const window = out.contextWindowTokens ?? fallbackWindow;
    if (window > 0) {
      out.contextWindowTokens = window;
      out.contextPercentUsed = Math.max(0, Math.min((out.contextUsedTokens / window) * 100, 100));
    }
  }
  if (out.contextStatus !== "ok") {
    out.contextStatus = "unavailable";
    out.contextLabel = "Context N/A";
    out.contextUsedTokens = undefined;
    out.contextWindowTokens = undefined;
    out.contextPercentUsed = undefined;
    out.contextSource = undefined;
  }
  for (const msg of out.messages) {
    msg.isStreaming = false;
  }
  return out;
}
