import type {
  NormalizedCliEvent,
  SessionEventRecord,
  SessionSnapshot,
  SessionSnapshotMessage,
  SnapshotContentBlock,
  Tool,
} from "./types.js";

interface ParseContext {
  lastThreadId?: string;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function parseJson(line: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function parseClaudeLine(line: string): NormalizedCliEvent[] {
  const obj = parseJson(line.trim());
  if (!obj) return [];
  const type = typeof obj.type === "string" ? obj.type : "";
  if (type === "system") {
    return [{ type: "message_start", role: "system" }];
  }
  if (type === "assistant") {
    const message = obj.message;
    if (!message || typeof message !== "object" || Array.isArray(message)) return [];
    const content = (message as Record<string, unknown>).content;
    if (!Array.isArray(content)) return [];
    const events: NormalizedCliEvent[] = [];
    for (const entry of content) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const block = entry as Record<string, unknown>;
      const blockType = typeof block.type === "string" ? block.type : "";
      if (blockType === "text") {
        events.push({
          type: "content_block",
          role: "assistant",
          block: { type: "text", text: typeof block.text === "string" ? block.text : "" },
        });
      } else if (blockType === "thinking") {
        events.push({
          type: "content_block",
          role: "assistant",
          block: { type: "thinking", text: typeof block.thinking === "string" ? block.thinking : "" },
        });
      } else if (blockType === "tool_use" || blockType === "server_tool_use") {
        events.push({
          type: "content_block",
          role: "assistant",
          block: {
            type: "tool_use",
            toolName: typeof block.name === "string" ? block.name : "tool",
            toolId: typeof block.id === "string" ? block.id : undefined,
            toolInput: block.input,
          },
        });
      } else if (blockType === "tool_result") {
        let result = "";
        if (typeof block.content === "string") {
          result = block.content;
        } else if (Array.isArray(block.content)) {
          result = block.content
            .filter((item) => item && typeof item === "object" && !Array.isArray(item))
            .map((item) => {
              const typed = item as Record<string, unknown>;
              return typeof typed.text === "string" ? typed.text : "";
            })
            .filter((text) => text.length > 0)
            .join("\n");
        }
        events.push({
          type: "content_block",
          role: "assistant",
          block: {
            type: "tool_result",
            toolId: typeof block.tool_use_id === "string" ? block.tool_use_id : undefined,
            result,
            isError: block.is_error === true,
          },
        });
      }
    }
    return events;
  }
  if (type === "result") {
    const out: NormalizedCliEvent[] = [];
    const usage = obj.usage;
    if (usage && typeof usage === "object" && !Array.isArray(usage)) {
      const typed = usage as Record<string, unknown>;
      out.push({
        type: "usage",
        inputTokens: typeof typed.input_tokens === "number" ? typed.input_tokens : undefined,
        outputTokens: typeof typed.output_tokens === "number" ? typed.output_tokens : undefined,
        contextUsedTokens: typeof typed.input_tokens === "number" ? typed.input_tokens : undefined,
        contextSource: "derived",
      });
    }
    out.push({
      type: "message_complete",
      conversationId: typeof obj.session_id === "string" ? obj.session_id : undefined,
    });
    return out;
  }
  if (type === "error") {
    const err = obj.error;
    let message = "Unknown error";
    if (err && typeof err === "object" && !Array.isArray(err)) {
      const typed = err as Record<string, unknown>;
      if (typeof typed.message === "string") {
        message = typed.message;
      }
    }
    return [{ type: "error", block: { type: "error", text: message } }];
  }
  return [];
}

function parseCodexLine(line: string, context: ParseContext): NormalizedCliEvent[] {
  const obj = parseJson(line.trim());
  if (!obj) return [];
  const type = typeof obj.type === "string" ? obj.type : "";
  if (type === "event_msg") {
    const payload = obj.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
    const typedPayload = payload as Record<string, unknown>;
    if (typedPayload.type !== "token_count") return [];
    const info = typedPayload.info;
    if (!info || typeof info !== "object" || Array.isArray(info)) return [];
    const typedInfo = info as Record<string, unknown>;
    const lastUsage = typedInfo.last_token_usage;
    const typedUsage =
      lastUsage && typeof lastUsage === "object" && !Array.isArray(lastUsage)
        ? (lastUsage as Record<string, unknown>)
        : undefined;
    const contextUsedTokens = typeof typedUsage?.input_tokens === "number" ? typedUsage.input_tokens : undefined;
    const contextWindowTokens =
      typeof typedInfo.model_context_window === "number" ? typedInfo.model_context_window : undefined;
    if (contextUsedTokens == null) return [];
    return [{
      type: "usage",
      contextUsedTokens,
      contextWindowTokens,
      contextSource: "provider",
    }];
  }
  if (type === "thread.started") {
    context.lastThreadId = typeof obj.thread_id === "string" ? obj.thread_id : undefined;
    return [{ type: "message_start", role: "assistant" }];
  }
  if (type === "item.completed" || type === "item.created") {
    const item = obj.item;
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const typedItem = item as Record<string, unknown>;
    const itemType = typeof typedItem.type === "string" ? typedItem.type : "";
    if (itemType === "agent_message" || itemType === "message") {
      if (typeof typedItem.text === "string" && typedItem.text.length > 0) {
        if (typedItem.text.includes("<turn_aborted>")) return [];
        return [{
          type: "content_block",
          role: "assistant",
          block: { type: "text", text: typedItem.text },
        }];
      }
      const content = typedItem.content;
      if (!Array.isArray(content)) return [];
      const out: NormalizedCliEvent[] = [];
      for (const blockRaw of content) {
        if (!blockRaw || typeof blockRaw !== "object" || Array.isArray(blockRaw)) continue;
        const block = blockRaw as Record<string, unknown>;
        const blockType = typeof block.type === "string" ? block.type : "";
        if (blockType !== "output_text" && blockType !== "text") continue;
        const text = typeof block.text === "string" ? block.text : "";
        if (!text || text.includes("<turn_aborted>")) continue;
        out.push({
          type: "content_block",
          role: "assistant",
          block: { type: "text", text },
        });
      }
      return out;
    }
    if (itemType === "reasoning") {
      const text = typeof typedItem.text === "string" ? typedItem.text : "";
      if (text.length > 0) {
        return [{ type: "content_block", role: "assistant", block: { type: "thinking", text } }];
      }
      const summary = typedItem.summary;
      if (!Array.isArray(summary)) return [];
      const summaryText = summary
        .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
        .map((entry) => {
          const typed = entry as Record<string, unknown>;
          return typeof typed.text === "string" ? typed.text : "";
        })
        .filter((value) => value.length > 0)
        .join("\n");
      if (!summaryText) return [];
      return [{ type: "content_block", role: "assistant", block: { type: "thinking", text: summaryText } }];
    }
    if (itemType === "function_call") {
      const name = typeof typedItem.name === "string" ? typedItem.name : "tool";
      const args = typeof typedItem.arguments === "string" ? typedItem.arguments : "";
      let toolInput: unknown = args;
      try {
        toolInput = JSON.parse(args);
      } catch {
        // keep raw string
      }
      return [{
        type: "content_block",
        role: "assistant",
        block: {
          type: "tool_use",
          toolName: name,
          toolId: typeof typedItem.call_id === "string" ? typedItem.call_id : undefined,
          toolInput,
        },
      }];
    }
    if (itemType === "function_call_output") {
      const result = typeof typedItem.output === "string" ? typedItem.output : "";
      if (!result.trim()) return [];
      return [{
        type: "content_block",
        role: "assistant",
        block: {
          type: "tool_result",
          toolId: typeof typedItem.call_id === "string" ? typedItem.call_id : undefined,
          result,
        },
      }];
    }
  }
  if (type === "turn.completed") {
    const out: NormalizedCliEvent[] = [];
    out.push({ type: "message_complete", conversationId: context.lastThreadId });
    return out;
  }
  if (type === "turn.failed") {
    const text = typeof obj.error === "string"
      ? obj.error
      : (typeof obj.message === "string" ? obj.message : "Turn failed");
    return [
      { type: "error", block: { type: "error", text } },
      { type: "message_complete", conversationId: context.lastThreadId },
    ];
  }
  if (type === "error") {
    const text = typeof obj.message === "string" ? obj.message : "Unknown Codex error";
    return [{ type: "error", block: { type: "error", text } }];
  }
  return [];
}

function parseGeminiComplete(jsonBlob: string): NormalizedCliEvent[] {
  const trimmed = jsonBlob.trim();
  if (!trimmed) return [];
  const obj = parseJson(trimmed);
  if (!obj) {
    return [{ type: "error", block: { type: "error", text: "Failed to parse Gemini JSON response" } }];
  }
  const events: NormalizedCliEvent[] = [{ type: "message_start", role: "assistant" }];
  let foundContent = false;
  if (typeof obj.response === "string" && obj.response.length > 0) {
    events.push({ type: "content_block", role: "assistant", block: { type: "text", text: obj.response } });
    foundContent = true;
  }
  if (!foundContent && typeof obj.text === "string" && obj.text.length > 0) {
    events.push({ type: "content_block", role: "assistant", block: { type: "text", text: obj.text } });
  }
  if (typeof obj.error === "string" && obj.error.length > 0) {
    events.push({ type: "error", block: { type: "error", text: obj.error } });
  }
  events.push({ type: "message_complete" });
  return events;
}

export function createToolParseContext(tool: Tool): ParseContext {
  if (tool === "codex") {
    return { lastThreadId: undefined };
  }
  return {};
}

export function parseToolLine(tool: Tool, line: string, context: ParseContext): NormalizedCliEvent[] {
  if (tool === "claude") return parseClaudeLine(line);
  if (tool === "codex") return parseCodexLine(line, context);
  return [];
}

export function parseToolComplete(tool: Tool, jsonBlob: string, _context: ParseContext): NormalizedCliEvent[] {
  if (tool === "gemini") return parseGeminiComplete(jsonBlob);
  return [];
}

function createEmptySnapshot(tool: Tool): SessionSnapshot {
  return {
    schemaVersion: 1,
    tool,
    lastEventSeq: 0,
    messages: [],
    turns: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    contextStatus: "unavailable",
    contextLabel: "Context N/A",
  };
}

function ensureAssistantMessage(snapshot: SessionSnapshot, turnIndex: number, timestamp: string): SessionSnapshotMessage {
  const last = snapshot.messages[snapshot.messages.length - 1];
  if (last && last.role === "assistant" && last.turnIndex === turnIndex) {
    return last;
  }
  const msg: SessionSnapshotMessage = {
    role: "assistant",
    content: [],
    timestamp,
    turnIndex,
    isStreaming: false,
  };
  snapshot.messages.push(msg);
  return msg;
}

function applyContextSnapshot(snapshot: SessionSnapshot, input: {
  usedTokens?: number;
  windowTokens?: number;
  source?: "provider" | "derived";
}): void {
  if (input.usedTokens == null || !Number.isFinite(input.usedTokens) || input.usedTokens < 0) {
    return;
  }
  snapshot.contextStatus = "ok";
  const boundedUsed = input.windowTokens != null && Number.isFinite(input.windowTokens) && input.windowTokens > 0
    ? Math.min(input.usedTokens, input.windowTokens)
    : input.usedTokens;
  snapshot.contextUsedTokens = Math.floor(boundedUsed);
  if (input.windowTokens != null && Number.isFinite(input.windowTokens) && input.windowTokens > 0) {
    snapshot.contextWindowTokens = Math.floor(input.windowTokens);
    snapshot.contextPercentUsed = Math.max(
      0,
      Math.min((snapshot.contextUsedTokens / snapshot.contextWindowTokens) * 100, 100),
    );
  }
  snapshot.contextSource = input.source ?? "derived";
  snapshot.contextLabel = undefined;
}

function processCliEvent(
  snapshot: SessionSnapshot,
  event: NormalizedCliEvent,
  turnIndex: number,
  timestamp: string,
): void {
  if (event.type === "message_start") {
    ensureAssistantMessage(snapshot, turnIndex, timestamp);
    return;
  }
  if (event.type === "content_block" && event.block) {
    const msg = ensureAssistantMessage(snapshot, turnIndex, timestamp);
    msg.content.push(event.block as SnapshotContentBlock);
    return;
  }
  if (event.type === "usage") {
    if (event.inputTokens == null && event.outputTokens == null) {
      applyContextSnapshot(snapshot, {
        usedTokens: event.contextUsedTokens,
        windowTokens: event.contextWindowTokens,
        source: event.contextSource,
      });
      return;
    }
    const msg = ensureAssistantMessage(snapshot, turnIndex, timestamp);
    msg.content.push({
      type: "usage",
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
    });
    snapshot.totalInputTokens += event.inputTokens ?? 0;
    snapshot.totalOutputTokens += event.outputTokens ?? 0;
    applyContextSnapshot(snapshot, {
      usedTokens: event.contextUsedTokens,
      windowTokens: event.contextWindowTokens,
      source: event.contextSource,
    });
    return;
  }
  if (event.type === "error" && event.block) {
    const msg = ensureAssistantMessage(snapshot, turnIndex, timestamp);
    msg.content.push(event.block as SnapshotContentBlock);
    return;
  }
  if (event.type === "message_complete") {
    const msg = ensureAssistantMessage(snapshot, turnIndex, timestamp);
    msg.isStreaming = false;
  }
}

export function materializeSnapshot(tool: Tool, events: SessionEventRecord[]): SessionSnapshot {
  const snapshot = createEmptySnapshot(tool);
  let currentTurnIndex = -1;

  for (const event of events) {
    snapshot.lastEventSeq = Math.max(snapshot.lastEventSeq, event.seq);
    const ts = toIso(event.ts);

    if (event.kind === "turn_start") {
      const turnIndex = snapshot.turns.length;
      currentTurnIndex = turnIndex;
      const prompt = event.prompt ?? "";
      snapshot.turns.push({
        index: turnIndex,
        userPrompt: prompt,
        startedAt: ts,
      });
      if (prompt.trim().length > 0) {
        snapshot.messages.push({
          role: "user",
          content: [{ type: "text", text: prompt }],
          timestamp: ts,
          turnIndex,
          isStreaming: false,
        });
      }
      continue;
    }

    if (event.kind === "turn_end") {
      const turn = snapshot.turns[event.turnIndex] ?? snapshot.turns[currentTurnIndex];
      if (turn) {
        turn.endedAt = ts;
        turn.exitCode = event.exitCode;
      }
      const msg = snapshot.messages[snapshot.messages.length - 1];
      if (msg && msg.role === "assistant" && msg.turnIndex === event.turnIndex) {
        msg.isStreaming = false;
      }
      continue;
    }

    if (event.kind === "cli_event" && event.cliEvent) {
      const targetTurn = event.turnIndex >= 0 ? event.turnIndex : currentTurnIndex;
      if (targetTurn < 0) continue;
      processCliEvent(snapshot, event.cliEvent, targetTurn, ts);
    }
  }

  return snapshot;
}
